# AGENTS.md — 给 AI agent 的操作手册

**v1.0.0**（变更见 [CHANGELOG.md](CHANGELOG.md)）。把这个项目丢给 AI 时，读这个文件就够了。

两块东西：`index.html` + `data/` 是数据站（成熟，直接用）；`outreach/` 是外链投放管道
（代码经 8 轮外审，但**尚未端到端真跑过**；任何真实目录投放都只能在 Ego 中逐站执行，首次先验证 5 个目标）。

## 跑起来（唯一需要做的事）

```bash
cd <本目录> && python3 -m http.server 8899
# 浏览器打开 http://127.0.0.1:8899/
```

- 纯静态，无依赖、无构建、无 npm。
- 必须用 HTTP 服务打开；`file://` 直接双击打不开数据（fetch 限制）。
- 验证方式：`curl -s http://127.0.0.1:8899/data/data.json | head -c 200` 返回 JSON 即正常。

## 结构

- `index.html` — 全部 UI（原生 JS，无框架）。四个视图：总榜/增长榜/新品雷达/外链库。
- `data/data.json` — 站点数组。每行字段：
  `domain, name, desc_zh, desc_en, categories[], free, signup, visits, clicks, bl, bl_blog, global_rank, sem_traffic, sem_positions, mix{organic,direct,…}, monthly[[YYYY-MM-DD,visits]…], mom, kw[{n,v,c}], listed_month, n_dirs, registered, organic, dr`
- `data/library.json` — 外链库页面数组：`url, src, title, plat, ascore, nt, targets[{d,a}], seen`
- `data/links/<domain>.json` — 单域 dofollow 明细：`[{u,s,a,p,s2,f}]`（u=来源页,s=标题,a=锚文本,p=平台,s2=权重分,f=首见 epoch 秒）。
  **每域按 s2 降序截 top 100，不是全量**（2,253 域共 22.3 万行）；对外别说"全部来源"。
- `data/links/index.json` — 有明细的域名清单（字符串数组，当前 2,253 个）。

## 改 UI 时的注意点

- index.html 里 fetch 路径全部以 `data/` 开头，移动文件要同步改。
- 数据文件带 `?v=<DATA_VERSION>` 防缓存（常量在 index.html 顶部）。**换数据快照就改这个常量**；
  别改回 `?t=Date.now()` —— 那会让 11MB 的 data.json 每次打开页面都重下，HTTP 缓存彻底失效。
- 搜索框输入有 140ms 防抖：`render()` 要把 15k 个 `<tr>` 交给 innerHTML 建 DOM（实测约 327ms），
  每敲一键重渲一次会丢帧。新增高频触发点时照此办理。
- 新视图加进 `VIEWS` 数组 + `SORTS` 映射 + I18N 双语键（zh/en 都要）。
- 截图自测（有 playwright-core 的话）：起服务后访问四个 tab 各截一张。

## outreach/（外链投放工具）

用户看完数据要投放时用这个（管道细节详见 `outreach/README.md`，但其中旧浏览器和实时投放命令不适用于真实投放，以下规则优先）：

```bash
cd outreach && npm install   # 仅安装旧工具与离线测试依赖；真实目录投放不得使用 Playwright/Chrome
python3 configure.py                     # LLM 端点 + 打码/收信 key(本机界面,带实测按钮)
python3 check_llm.py                     # 或纯命令行验端点(连通性 + json_object)
cp kit.example.json kit.json             # 创建本次运行配置文件
cp identities.example.json identities.json  # persona 池
python3 targets.py                        # 只生成候选 worklist.jsonl，不会提交
```

### 实时目录投放操作规则

#### 机制与飞书数据面

- 本文件是实时投放机制的唯一操作手册，规定登录顺序、Turnstile 顺序、单次 POST、交接条件以及软硬阻碍的判定。
- 飞书只存数据，不替代本文件中的操作机制。
- 使用官方 `lark-cli` 并加 `--as user` 读取和更新飞书数据。
- 外链数据总目录：[外链建设](https://lcnnll51lape.feishu.cn/drive/folder/XMwFfLi2rlUfTcdRRMLciFU0nGe)。
- 操作员的共用身份资料和登录收信邮箱来自[基本资料](https://lcnnll51lape.feishu.cn/sheets/Ojw4s17ePhanBEtDEzrcbAmin6f)，其中「给 agent 用的邮箱」是注册、登录和验证邮件使用的邮箱，不是产品公开联系邮箱。
- 全局复用的平台账号及密码：[平台账号](https://lcnnll51lape.feishu.cn/sheets/VVIQsejZshywZ5tYCmhcwBUJnYd)。
- 全局复用的已实操平台信息、官方徽章和互链 HTML：[平台玩法](https://lcnnll51lape.feishu.cn/sheets/SXbCssNdUhlzdCtDVXlc7UWCnRb)。
- 单次运行的投放身份来自 Firstmate 为该活动加载的飞书资料包，不得在本文件硬编码具体活动产品。
- 投放台账按目录域名一站一行保存进度与实操证据。
- 公开列表和联系字段只使用本次活动资料中的公开邮箱。
- 登录邮箱与公开联系邮箱职责不同，不得虚构第三个邮箱，也不得使用 Gmail。
- 完成一次实际演练或真实投放后，无论结果如何，都必须在同一轮更新该活动的投放台账，包括结果、进度和实操证据。
- 真实投放成功后，还要把目录提供的官方徽章或互链 HTML 原样保存到平台玩法，并在使用时严格照抄提交页提供的代码。
- 不得纠正官方素材的文件名或凭记忆修改 URL，例如对方文件名是 `bage.png` 时不得改成 `badge.png`。
- 新生成目录密码后，必须写入平台账号和本 worktree 被 gitignore 的 `outreach/creds.json`，绝不能提交到 Git，也不能写入聊天。
- 不得把密码、税号、身份证件或银行账号打印或写入日志、聊天、Git、status。
- 桌面调研或 ChatGPT 候选列表不代表实操结果；只有来自真实投放的飞书投放台账行才计入进度。

#### 实时操作机制

- 实时目录投放只能使用 `ego-browser` 驱动 Ego。
- 实时投放不得使用 Chrome、Chromium、Playwright 或 `chrome-devtools-axi`，旧 `driver.py` 和 `agent_submit.mjs` 仅供代码维护和离线测试参考。
- 每个目录使用一个独立 Ego 空间，只在该站成功、失败或船长取消后关闭。
- 等待验证码或人工处理时必须保留当前 Ego 空间，不得中途关闭。
- 目标目录只收录导航、论坛、博客和 paid 类站点。
- 忽略站长目录（webmaster directories）以及自然获得的引用和媒体报道（organic/media citations）。
- Raindrop 一类目标的正确做法是自建公开收藏页，不是向其他人的 `*.raindrop.page` 投稿。
- 每个站点最多执行一次真实 POST。
- 真实 POST 发出后绝不自动重试，`delivery_ambiguous` 永远只由人工裁决。
- 船长点名某个目录进行投放，即同时授权在该目录自动注册和自动登录，不再另行请求账号创建授权。
- 已有安全保存凭据的站点可以登录。
- 登录顺序：先邮箱，再 Google，再 GitHub。
- 缺少邮箱路径或邮箱路径走不通时，默认继续 Google，再不行则继续 GitHub。
- 邮箱加密码注册默认自动执行：自行生成密码，按上面的数据规则写入平台账号和 `outreach/creds.json`，填表，并用同 worktree 常驻的 `agent.qq.com` sweeper 完成验证。
- 密码栏不是交接，本次生成的密码由代理自己填写。
- Google 或 GitHub 登录默认自动执行，使用 Ego 中已经登录的 Default/Tao 会话完成。
- 不得把 “Continue with Google”、GitHub OAuth 或仅 OAuth 的最终提交墙交给操作员，也不得因此停下来等待判断。
- 仅在以下情况交接一次：验证码、数学题或 Turnstile；Ego 当前没有可用的 Google 或 GitHub 会话；站点要求填写操作员已有、并非本次生成的密码。
- 表单同时需要 Cloudflare Turnstile 或同类机器人验证时，必须先填完并冻结全部必填字段，再做验证；需要人工时也只在表单填完之后交接。
- 不得先让操作员完成验证，再回头填表或改字段。
- 改字段会作废验证、触发 CAPTCHA verification failed，并增加交互次数。
- 不得编造产品能力或素材。
- 已确认必填字段无法如实填写时，按硬性必需死路处理。
- 软性或可选阻碍必须由操作员判断，绝不能自动判定为失败。
- 软性或可选阻碍只包括互链或徽章要求、联盟或质量门槛。
- OAuth 登录不是软阻碍。
- DirOnix、SubmitDeck 一类免费互链站必须先登录，再走免费提交流程。
- 只有现场表单强制要求互链或徽章时，才把提交页提供的官方链接或代码原样放到产品站现网。
- 不得自行购买 `$9`、`$129` 等免排队或付费方案，除非船长对该站单独授权付款。
- 遇到软性或可选阻碍时，把当前实时 Ego 任务空间交给操作员，说明页面要求与可选方案，然后等待。
- 只要仍有可选方案，就不得把站点记为 `failed`，也不得以不可行为由跳过。
- 只有遇到硬性必需死路，或操作员明确拒绝所有仍可行的选项后，才能记录 `failed`。
- 硬性必需死路包括：确认没有提交入口；确认重复且站点已接受过提交（例如 HTTP 409）；确认站点宕机；Login 或 Register 明确标注 Coming soon；联系页看似可提交但实际无法发出；必填项无法按产品真实情况填写；入口连续打不开或超时。
- `mail_sweeper.py --loop` 必须与实时投放者运行在同一个隔离 worktree 中。
- 当 AgentMail 没有来信时，QQ 路径是实时收信路径。

**改 `outreach/` 任何代码，前后都跑 `bash outreach/tests/smoke.sh`**（语法 + Python 关键路径
29 项 + Node 关键路径 47 项 + 配置 py/js 对拍 43 组 + 12 进程并发认领）。
**"语法过 + import 过"不算回归**——这个脚本存在的原因是：曾经整段替换函数时连带删掉了
`state.py` 的 6 个函数，语法和 import 都照样通过，`NameError` 只在真调用到那行才炸。

LLM 配置收口在 `llm_config.py` / `llm_config.mjs`(两份规则逐条一致):
**填 base URL 就行**(`LLM_BASE_URL`,不用拼 `/chat/completions`),key 用
`LLM_API_KEY`,也认通用的 `OPENAI_BASE_URL` / `OPENAI_API_KEY` 和文件 `llm.json`;
旧名 `LLM_ENDPOINT` / `LLM_KEY` 仍可用但会提示改名。`python3 llm_config.py` 看当前解析结果。

**开工前确认运行条件齐全**（缺了别跑）：OpenAI 兼容 LLM 端点（LLM_* 环境变量）、收信信箱、persona 身份池（`identities.json`）和本次活动投放资料。
收信至少有一条路径可用：`agent.qq.com` 使用 agently-cli `auth login`；agentmail.to 使用写入 `my_site.json` 的 `agentmail_*` API key，并安装 `agentmail` 与 `curl_cffi`。
`mail_sweeper.py` 是生产文件逐字复制的最小改动移植，改它先读文件头移植说明。

- 实时投放先在 Ego 中逐站验证 5 个目标，没问题再放量；不得用 `driver.py` 或 `agent_submit.mjs` 对真实站点投放；state.jsonl 是唯一状态源，别手改
- **写账本只能走 `state.upsert_submission` / `state.mjs upsertSubmission`**，不许直接
  往 state.jsonl 追加行：迁移守卫（投达态不许被打回 blocked/failed）就在那里，绕过去
  = 把已投达的域重新放回可重投池 = 重复提交。driver.py 的 `save_state()` 已收口到守卫，
  新加写入点照此办理
- **防重复投递的第二道闸是 `outreach/claims/<域>.claim`**（`claimDelivery` 用 O_EXCL 原子创建，
  内核保证只有一个创建者成功）。标记**不会自动释放**——投达即终态；确实需要放回只能人工
  `releaseClaim(domain)`，且必须先确认那个域真的没投出去
- 单站时间预算：`SUBMIT_MAX_MINUTES`（默认 8，driver 传 10）。看门狗触发点由
  `makeWatchdogPlan` 按 driver 的 900s 包装硬杀倒推，超过约 12 分钟会被**自动钳住**
  （启动时打一行日志说明）——想让单站跑更久，得先把 driver 的 `timeout=900` 一起抬
- 提交后验证邮件由 `mail_sweeper.py --loop` 自动处理（agently-cli 收信+LLM 判意图+点验证链接，
  四条安全闸别动）；先 `--dry-run` 演一遍再放--loop
- 旧运行时代码在未配置 capsolver_key 时会把验证码站标 `manual`；这不是实时 Ego 投放规则，实时任务必须交给操作员并等待，不要自动过码
- delivery_ambiguous = 提交可能已投达但终局未定，永不自动重投，只能人工裁决
- pending_review ≠ 上线：终核器 `verify_link.mjs --pending --update-status` 确认在线且
  dofollow 才抬 success（offline_confirmed 连续 ≥3 次才写 failed——单次核验不判死，
  unknown 不动）；建议每周跑一次
- LLM 端点/打码 key/代理全走环境变量或 my_site.json；私仓的任何 key/产品资料不得进本目录

## 审查记录

`docs/CODEX_REVIEW.md` 是 8 轮独立外审（Codex）的完整记录：逐轮 finding、修法、实测。
新 agent 接手 `outreach/` 前值得扫一眼——里面记了两类反复出现的错法：
「这个防御的代码路径真的会被走到吗」，以及「同一个 bug 在别处是不是已经修过了」。
再加一条：**动手写新实现前先 grep 仓库里有没有已经写对的**（文件锁就是先有 `creds.mjs`
写对了，我又重写了一遍错的）。

## 数据更新

本仓库只含数据快照。`scripts/` 下的聚合脚本（build_data / build_link_library / build_links_split）
演示了聚合逻辑，但它们读的是私有数据湖（backlinks-v2/datasets），外部跑不了。
要换自己的数据：按上面的 JSON 字段格式生成 `data/data.json` 即可，UI 不用动。

## 免责声明

流量/排名/反链数据为第三方服务估算值，仅研究参考，别当精确值引用。

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
