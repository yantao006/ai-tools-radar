// Ego Browser adapter for agent_submit.mjs.
//
// The submit agent keeps its existing Page-like workflow, but every browser operation is
// executed by helpers injected by `ego-browser nodejs`. This module never launches a browser.

import fs from 'node:fs';

const ELEMENT_ATTR = 'data-ego-outreach-id';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function literal(value) {
  if (value === undefined) return 'undefined';
  if (typeof value === 'number' && !Number.isFinite(value)) return 'undefined';
  return JSON.stringify(value);
}

function callableSource(fn) {
  if (typeof fn !== 'function') throw new TypeError('evaluate requires a function');
  return `(${fn.toString()})`;
}

function elementSelector(id) {
  return `[${ELEMENT_ATTR}=${JSON.stringify(id)}]`;
}

function queryScript(selector) {
  return String.raw`(() => {
    const raw = ${JSON.stringify(String(selector || ''))};
    const attr = ${JSON.stringify(ELEMENT_ATTR)};
    const visible = (el) => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
    const textOf = (el) => String((el && (el.innerText || el.textContent || el.value)) || '');
    const parseText = (rawValue) => {
      const value = String(rawValue || '').trim();
      try { return JSON.parse(value); } catch { return value.replace(/^['"]|['"]$/g, ''); }
    };
    const splitTop = (value) => {
      const out = [];
      let start = 0, square = 0, round = 0, quote = '', escaped = false;
      for (let i = 0; i < value.length; i++) {
        const ch = value[i];
        if (quote) {
          if (escaped) escaped = false;
          else if (ch === '\\') escaped = true;
          else if (ch === quote) quote = '';
          continue;
        }
        if (ch === '"' || ch === "'") { quote = ch; continue; }
        if (ch === '[') square++;
        else if (ch === ']') square = Math.max(0, square - 1);
        else if (ch === '(') round++;
        else if (ch === ')') round = Math.max(0, round - 1);
        else if (ch === ',' && square === 0 && round === 0) {
          out.push(value.slice(start, i).trim()); start = i + 1;
        }
      }
      out.push(value.slice(start).trim());
      return out.filter(Boolean);
    };
    const queryPart = (part) => {
      if (/^text=/.test(part)) {
        const wanted = parseText(part.slice(5));
        const matches = [...document.querySelectorAll('body *')]
          .filter((el) => visible(el) && textOf(el).includes(wanted));
        const leaves = matches.filter((el) => ![...el.children]
          .some((child) => visible(child) && textOf(child).includes(wanted)));
        return leaves.length ? leaves : matches;
      }
      const requireVisible = /:visible\b/.test(part);
      part = part.replace(/:visible\b/g, '');

      // Playwright's label:has-text("x") input form is used by the legacy locator helper.
      const parentText = part.match(/^([^:]+):has-text\((.+)\)\s+(.+)$/);
      if (parentText) {
        const parents = [...document.querySelectorAll(parentText[1])];
        const wanted = parseText(parentText[2]);
        const found = parents.filter((el) => textOf(el).includes(wanted))
          .flatMap((el) => [...el.querySelectorAll(parentText[3])]);
        return requireVisible ? found.filter(visible) : found;
      }

      let wanted = null;
      part = part.replace(/:has-text\((.+)\)$/g, (_, value) => {
        wanted = parseText(value); return '';
      });
      let found = [];
      try { found = [...document.querySelectorAll(part || '*')]; } catch { return []; }
      if (wanted !== null) found = found.filter((el) => textOf(el).includes(wanted));
      if (requireVisible) found = found.filter(visible);
      return found;
    };

    const seen = new Set();
    const elements = [];
    for (const part of splitTop(raw)) {
      for (const el of queryPart(part)) {
        if (!el || seen.has(el)) continue;
        seen.add(el); elements.push(el);
      }
    }
    window.__egoOutreachElementSeq = (window.__egoOutreachElementSeq || 0);
    return elements.map((el) => {
      let id = el.getAttribute(attr);
      if (!id) {
        id = 'e' + (++window.__egoOutreachElementSeq);
        el.setAttribute(attr, id);
      }
      return id;
    });
  })()`;
}

class EgoRequest {
  constructor(page, params) {
    this.page = page;
    this.params = params || {};
    this.data = this.params.request || {};
  }

  url() { return String(this.data.url || ''); }
  resourceType() { return String(this.params.resourceType || this.params.type || 'other').toLowerCase(); }
  isNavigationRequest() { return this.resourceType() === 'document'; }
  frame() { return this.params.frameId && this.params.frameId === this.page._mainFrameId ? this.page.mainFrame() : {}; }
  method() { return String(this.data.method || 'GET'); }
  postData() { return this.data.postData || ''; }
}

class EgoRoute {
  constructor(page, params) {
    this.page = page;
    this.params = params;
    this.requestValue = new EgoRequest(page, params);
    this.done = false;
  }

  request() { return this.requestValue; }

  async continue() {
    if (this.done) return;
    this.done = true;
    await this.page._helpers.cdp('Fetch.continueRequest', { requestId: this.params.requestId });
  }

  async abort() {
    if (this.done) return;
    this.done = true;
    await this.page._helpers.cdp('Fetch.failRequest', {
      requestId: this.params.requestId,
      errorReason: 'BlockedByClient',
    });
  }
}

class EgoResponse {
  constructor(page, response, request, requestId, body = '') {
    this.page = page;
    this.response = response || {};
    this.requestValue = request || {};
    this.requestId = requestId;
    this.body = body;
  }

  url() { return String(this.response.url || this.requestValue.url || ''); }
  status() { return Number(this.response.status || 0); }
  headers() {
    const out = {};
    for (const [key, value] of Object.entries(this.response.headers || {})) {
      out[String(key).toLowerCase()] = String(value);
    }
    return out;
  }
  request() {
    const req = this.requestValue;
    return {
      method: () => String(req.method || 'GET'),
      postData: () => req.postData || '',
    };
  }
  async text() { return this.body; }
}

class EgoElementHandle {
  constructor(page, id) {
    this.page = page;
    this.id = id;
  }

  _selector() { return elementSelector(this.id); }

  async evaluate(fn, ...args) {
    await this.page._ensureSelected();
    const values = args.map(literal).join(',');
    const source = `(() => { const e = document.querySelector(${JSON.stringify(this._selector())});`
      + ` if (!e) throw new Error('stale Ego element'); return ${callableSource(fn)}(e${values ? ',' + values : ''}); })()`;
    return this.page._helpers.js(source);
  }

  async isVisible() {
    return this.evaluate((el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  }

  async getAttribute(name) {
    return this.evaluate((el, key) => el.getAttribute(key), name);
  }

  async scrollIntoViewIfNeeded() {
    return this.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
  }

  async click() {
    await this.page._ensureSelected();
    await this.page._helpers.click(this._selector(), { label: 'outreach agent click' });
    await this.page._afterAction();
  }

  async fill(value) {
    await this.page._ensureSelected();
    await this.page._helpers.fillInput(this._selector(), String(value ?? ''));
    await this.page._afterAction();
  }

  async setInputFiles(file) {
    await this.page._ensureSelected();
    await this.page._helpers.uploadFile(this._selector(), file);
    await this.page._afterAction();
  }
}

class EgoLocator {
  constructor(page, selector, options = {}) {
    this.page = page;
    this.selector = selector;
    this.options = options;
  }

  first() { return new EgoLocator(this.page, this.selector, { ...this.options, first: true }); }
  filter(options = {}) { return new EgoLocator(this.page, this.selector, { ...this.options, ...options }); }

  async _handles() {
    let handles = await this.page.$$(this.selector);
    if (this.options.hasText) {
      const wanted = this.options.hasText;
      const kept = [];
      for (const handle of handles) {
        const text = await handle.evaluate((el) => String(el.innerText || el.textContent || el.value || ''));
        const matches = wanted instanceof RegExp ? (wanted.lastIndex = 0, wanted.test(text)) : text.includes(String(wanted));
        if (matches) kept.push(handle);
      }
      handles = kept;
    }
    return this.options.first ? handles.slice(0, 1) : handles;
  }

  async count() { return (await this._handles()).length; }
  async evaluate(fn, ...args) {
    const handle = (await this._handles())[0];
    if (!handle) throw new Error(`Ego locator did not match: ${this.selector}`);
    return handle.evaluate(fn, ...args);
  }
  async click(options) {
    const handle = (await this._handles())[0];
    if (!handle) throw new Error(`Ego locator did not match: ${this.selector}`);
    return handle.click(options);
  }
}

class EgoPage {
  constructor(context, tab) {
    this.contextValue = context;
    this._helpers = context.helpers;
    this.targetId = tab.targetId;
    this._url = tab.url || 'about:blank';
    this._closed = false;
    this._mainFrame = {};
    this._mainFrameId = '';
    this._pageRoutes = [];
    this._responseHandlers = [];
    this._requests = new Map();
    this._responses = new Map();
    this._fetchEnabled = false;
    this._pumpStop = false;
    this._pumpPromise = null;
    this._lastDocumentStatus = 0;
    this.keyboard = {
      type: async (text) => {
        await this._ensureSelected();
        await this._helpers.typeText(String(text));
        await this._afterAction();
      },
    };
  }

  context() { return this.contextValue; }
  mainFrame() { return this._mainFrame; }
  url() { return this._url; }
  isClosed() { return this._closed; }

  async _ensureSelected() {
    if (this._closed) throw new Error('Ego tab is closed');
    const tabs = await this._helpers.listTabs();
    const tab = tabs.find((item) => item.targetId === this.targetId);
    if (!tab) { this._closed = true; throw new Error('Ego tab is no longer available'); }
    if (!tab.active) await this._helpers.switchTab(this.targetId);
    this._url = tab.url || this._url;
  }

  async _refresh() {
    await this._ensureSelected();
    try {
      const info = await this._helpers.pageInfo();
      if (info && info.url) this._url = info.url;
    } catch {}
    try {
      const tree = await this._helpers.cdp('Page.getFrameTree', {});
      this._mainFrameId = tree && tree.frameTree && tree.frameTree.frame && tree.frameTree.frame.id || '';
    } catch {}
    await this.contextValue._syncTabs();
  }

  async _afterAction() {
    await sleep(80);
    await this._refresh();
    if (!this._fetchEnabled) await this._drainEvents();
  }

  _matchingRoute() {
    if (this._pageRoutes.length) return this._pageRoutes[this._pageRoutes.length - 1].handler;
    if (this.contextValue.routes.length) return this.contextValue.routes[this.contextValue.routes.length - 1].handler;
    return null;
  }

  async _handleFetch(params) {
    const route = new EgoRoute(this, params);
    const handler = this._matchingRoute();
    try {
      if (handler) await handler(route);
      if (!route.done) await route.continue();
    } catch {
      if (!route.done) await route.abort().catch(() => {});
    }
  }

  async _dispatchResponse(response, request, requestId, body = '') {
    if (!this._responseHandlers.length) return;
    const wrapped = new EgoResponse(this, response, request, requestId, body);
    for (const handler of this._responseHandlers) {
      try { await handler(wrapped); } catch {}
    }
  }

  async _processEvents(events) {
    for (const event of events || []) {
      const params = event.params || {};
      if (event.method === 'Fetch.requestPaused') {
        await this._handleFetch(params);
        continue;
      }
      if (event.method === 'Network.requestWillBeSent') {
        if (params.redirectResponse) {
          const previous = this._requests.get(params.requestId) || params.request || {};
          await this._dispatchResponse(params.redirectResponse, previous, params.requestId, '');
        }
        this._requests.set(params.requestId, params.request || {});
        continue;
      }
      if (event.method === 'Network.responseReceived') {
        if (this._mainFrameId && params.frameId && params.frameId !== this._mainFrameId) continue;
        this._responses.set(params.requestId, params.response || {});
        if (String(params.type || '').toLowerCase() === 'document') {
          this._lastDocumentStatus = Number(params.response && params.response.status || 0);
        }
        continue;
      }
      if (event.method === 'Network.loadingFinished') {
        const response = this._responses.get(params.requestId);
        if (!response) continue;
        const request = this._requests.get(params.requestId) || {};
        let body = '';
        try {
          const result = await this._helpers.cdp('Network.getResponseBody', { requestId: params.requestId });
          body = result && result.body || '';
          if (result && result.base64Encoded) body = Buffer.from(body, 'base64').toString('utf8');
        } catch {}
        await this._dispatchResponse(response, request, params.requestId, body);
        this._responses.delete(params.requestId);
      }
    }
  }

  async _drainEvents() {
    const events = await this._helpers.drainEvents();
    await this._processEvents(events);
  }

  async _startPump() {
    if (this._pumpPromise) return;
    await this._ensureSelected();
    await this._helpers.cdp('Network.enable', {});
    await this._helpers.cdp('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    this._fetchEnabled = true;
    this._pumpStop = false;
    this._pumpPromise = (async () => {
      while (!this._pumpStop) {
        try { await this._drainEvents(); } catch {}
        await sleep(20);
      }
    })();
  }

  async _stopPump() {
    this._pumpStop = true;
    if (this._pumpPromise) await Promise.race([this._pumpPromise, sleep(500)]).catch(() => {});
    this._pumpPromise = null;
    if (this._fetchEnabled) {
      await this._ensureSelected().catch(() => {});
      await this._helpers.cdp('Fetch.disable', {}).catch(() => {});
    }
    this._fetchEnabled = false;
  }

  async addInitScript(fn) {
    await this._ensureSelected();
    const source = `${callableSource(fn)}();`;
    await this._helpers.cdp('Page.addScriptToEvaluateOnNewDocument', { source });
  }

  async route(pattern, handler) {
    this._pageRoutes.push({ pattern, handler });
    await this._startPump();
  }

  async unroute(pattern, handler) {
    this._pageRoutes = this._pageRoutes.filter((item) => item.pattern !== pattern || item.handler !== handler);
  }

  on(event, handler) {
    if (event === 'response') this._responseHandlers.push(handler);
  }

  async goto(url, options = {}) {
    await this._ensureSelected();
    this._lastDocumentStatus = 0;
    await this._helpers.gotoAndWait(url, {
      timeout: Math.max(1, Number(options.timeout || 30000) / 1000),
      settle: 0.3,
    });
    await this._refresh();
    await sleep(120);
    return { status: () => this._lastDocumentStatus };
  }

  async reload(options = {}) { return this.goto(this._url, options); }

  async waitForTimeout(ms) {
    await sleep(Number(ms) || 0);
    await this._refresh();
    if (!this._fetchEnabled) await this._drainEvents();
  }

  async waitForLoadState(_state, options = {}) {
    await this._ensureSelected();
    await this._helpers.waitForLoad({ timeout: Math.max(1, Number(options.timeout || 30000) / 1000) });
    await this._refresh();
  }

  async evaluate(fn, ...args) {
    await this._ensureSelected();
    const values = args.map(literal).join(',');
    return this._helpers.js(`${callableSource(fn)}(${values})`);
  }

  async content() {
    await this._ensureSelected();
    return this._helpers.js('document.documentElement ? document.documentElement.outerHTML : ""');
  }

  async $$(selector) {
    await this._ensureSelected();
    const ids = await this._helpers.js(queryScript(selector));
    return (Array.isArray(ids) ? ids : []).map((id) => new EgoElementHandle(this, id));
  }

  async $(selector) { return (await this.$$(selector))[0] || null; }
  locator(selector) { return new EgoLocator(this, selector); }

  async screenshot(options = {}) {
    await this._ensureSelected();
    const result = await this._helpers.cdp('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: options.fullPage === true,
    });
    const data = Buffer.from(result.data, 'base64');
    if (options.path) fs.writeFileSync(options.path, data);
    return data;
  }

  async close() {
    if (this._closed) return;
    await this._stopPump();
    await this._helpers.closeTab(this.targetId);
    this._closed = true;
  }

  async _cleanup() { await this._stopPump(); }
}

class EgoContext {
  constructor(helpers, options = {}) {
    this.helpers = helpers;
    this.options = options;
    this.routes = [];
    this.initScripts = [];
    this.pagesCache = [];
    this.pageHandlers = [];
  }

  pages() { return this.pagesCache.filter((page) => !page.isClosed()); }
  on(event, handler) { if (event === 'page') this.pageHandlers.push(handler); }

  async _syncTabs() {
    const tabs = await this.helpers.listTabs();
    const known = new Map(this.pagesCache.map((page) => [page.targetId, page]));
    for (const tab of tabs) {
      let page = known.get(tab.targetId);
      if (!page) {
        page = new EgoPage(this, tab);
        this.pagesCache.push(page);
        for (const handler of this.pageHandlers) {
          try { await handler(page); } catch {}
        }
      } else {
        page._url = tab.url || page._url;
      }
    }
    for (const page of this.pagesCache) {
      if (!tabs.some((tab) => tab.targetId === page.targetId)) page._closed = true;
    }
    return this.pages();
  }

  async newPage() {
    let tab = await this.helpers.ensureRealTab();
    if (!tab) tab = await this.helpers.openOrReuseTab('about:blank', { wait: false });
    await this._syncTabs();
    let page = this.pagesCache.find((item) => item.targetId === tab.targetId);
    if (!page) {
      page = new EgoPage(this, tab);
      this.pagesCache.push(page);
    }
    for (const fn of this.initScripts) await page.addInitScript(fn);
    if (this.routes.length) await page._startPump();
    await page._refresh();
    return page;
  }

  async addInitScript(fn) {
    this.initScripts.push(fn);
    for (const page of this.pages()) await page.addInitScript(fn);
  }

  async route(pattern, handler) {
    this.routes.push({ pattern, handler });
    for (const page of this.pages()) await page._startPump();
  }

  async addCookies(cookies) {
    const page = this.pages()[0];
    if (!page) throw new Error('no Ego page for cookies');
    await page._ensureSelected();
    await this.helpers.cdp('Network.setCookies', { cookies });
  }

  async newCDPSession(page) {
    return {
      send: async (method, params = {}) => {
        await page._ensureSelected();
        return this.helpers.cdp(method, params);
      },
    };
  }

  async cleanup() {
    for (const page of this.pages()) await page._cleanup();
  }
}

class EgoBrowser {
  constructor(context) { this.contextValue = context; }
  contexts() { return [this.contextValue]; }
  async newContext() { return this.contextValue; }
  async close() { await this.contextValue.cleanup(); }
  isConnected() { return true; }
}

export async function createEgoBrowser(helpers, options = {}) {
  if (!helpers || typeof helpers.useOrCreateTaskSpace !== 'function') {
    throw new Error('agent_submit must run inside ego-browser nodejs');
  }
  const taskName = options.taskName || 'seedream-outreach';
  const task = await helpers.useOrCreateTaskSpace(taskName);
  const context = new EgoContext(helpers, options);
  await context._syncTabs();
  return { task, browser: new EgoBrowser(context), context };
}

export function egoEnvironment(source = process.env) {
  const exact = new Set([
    'HTTPS_PROXY', 'https_proxy', 'AGENT_EMAIL', 'AGENTMAIL_API_KEY', 'AGENTMAIL_INBOX_ID',
    'IDENTITY_FORCE', 'PYTHON_BIN', 'RESCUE_CONTEXT',
  ]);
  return Object.fromEntries(Object.entries(source || {}).filter(([key]) =>
    exact.has(key) || /^(LLM_|OPENAI_|OUTREACH_|SUBMIT_|CAPSOLVER_|TWOCAPTCHA_|AGENTMAIL_)/.test(key)));
}

export function egoLauncherSource(moduleUrl, argv, taskName = 'seedream-outreach', environmentFile = '') {
  return `
const task = await useOrCreateTaskSpace(${JSON.stringify(taskName)});
${environmentFile ? `{
  const fs = await import('node:fs');
  const bridged = JSON.parse(fs.readFileSync(${JSON.stringify(environmentFile)}, 'utf8'));
  Object.assign(process.env, bridged);
}` : ''}
globalThis.__EGO_BROWSER_HELPERS__ = {
  useOrCreateTaskSpace, ensureRealTab, openOrReuseTab, listTabs, switchTab, closeTab,
  gotoAndWait, pageInfo, waitForLoad, click, fillInput, typeText, uploadFile,
  js, cdp, drainEvents
};
process.argv.splice(0, process.argv.length, process.execPath, ${JSON.stringify(new URL(moduleUrl).pathname)}, ...${JSON.stringify(argv)});
const agent = await import(${JSON.stringify(String(moduleUrl))} + '?ego=' + Date.now());
await agent.AGENT_RUN;
cliLog('[ego] task space ' + task.name + ' completed this agent run');
`;
}
