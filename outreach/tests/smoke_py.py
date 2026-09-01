#!/usr/bin/env python3
"""Python 侧关键路径冒烟(被 smoke.sh 调用)。见 smoke.sh 顶部注释。"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
D = os.environ["OUTREACH_STATE_DIR"]
res = []
def t(name, fn):
    try:
        fn(); res.append((True, name, ""))
    except Exception as e:
        res.append((False, name, f"{type(e).__name__}: {e}"))

import state, dbwpy, llm_config, check_llm, read_otp, driver  # noqa: E402

t("upsert_submission",       lambda: state.upsert_submission("a.com", "pending_review", source="s"))
t("current_status",          lambda: state.current_status("a.com")["status"])
t("守卫拦截",                 lambda: state.upsert_submission("a.com", "blocked", source="s")["blockedRegression"])
t("历史 raw 键归一",           lambda: state.current_status("WWW.A.com")["status"])
t("record_event",            lambda: state.record_event("a.com", "note", source="s"))
t("add/active_constraints",  lambda: (state.add_constraint("a.com", "entry_404"), state.active_constraints("a.com")))
t("human_task_add",          lambda: state.human_task_add("a.com", blocker="x"))
t("mail_claim/done/release", lambda: (state.mail_claim("m1", "w"), state.mail_done("m1"), state.mail_release("m2")))
t("mail_is_done",            lambda: state.mail_is_done("m1"))
t("mail_recent_done",        lambda: state.mail_recent_done("a.com"))
t("mail_done_since",         lambda: state.mail_done_since("a.com", 0))
t("canon_domain",            lambda: state.canon_domain("WWW.A.com"))
t("with_file_lock",          lambda: state.with_file_lock(D + "/x", lambda: 1))
t("dbwpy known_sites",       lambda: dbwpy.conn().execute("SELECT domain FROM submissions UNION SELECT domain FROM submit_friendly").fetchall())
t("dbwpy v2_has",            lambda: dbwpy.conn().execute("SELECT 1 FROM submissions WHERE domain=? OR domain LIKE ? LIMIT 1", ("a.com", "%.a.com")).fetchone())
t("dbwpy product_for_site",  lambda: dbwpy.conn().execute("SELECT product_id, MAX(COALESCE(updated_at, submitted_at)) t FROM submissions WHERE domain=? OR domain LIKE ? GROUP BY product_id ORDER BY t DESC", ("a.com", "%.a.com")).fetchall())
t("dbwpy products",          lambda: dbwpy.conn().execute("SELECT id, url FROM products").fetchall())
t("dbwpy status 查询",        lambda: dbwpy.conn().execute("SELECT status FROM submissions WHERE domain=? AND product_id=?", ("a.com", 1)).fetchone())
t("dbwpy human_tasks 写",     lambda: dbwpy.conn().execute("INSERT INTO human_tasks (product_id, domain, url, blocker, guidance, status, created_at, kind) VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'), 'mail')", (1, "a.com", "", "b", "g")))
t("dbwpy w_retry",           lambda: dbwpy.w_retry("UPDATE submit_friendly SET email_verification='done' WHERE domain=?", ("a.com",)))
t("dbwpy migrate_key",       lambda: dbwpy.migrate_domain_key(domain="www.A.com"))
t("dbwpy mail_wait",         lambda: (dbwpy.mail_wait_register("a.com", "2030-01-01 00:00:00", 1), dbwpy.mail_waiting_now(), dbwpy.mail_wait_clear("a.com")))
t("llm_config.load",         lambda: llm_config.load())
t("llm_config.chat_url",     lambda: llm_config.chat_url("https://x.com"))
t("llm_config.origin_of",    lambda: llm_config.origin_of("https://x.com/v1"))
t("llm_config.mask",         lambda: llm_config.mask("sk-abcdefghijklmn"))
t("read_otp._matches",       lambda: read_otp._matches("a.com", "x@a.com", "s"))
t("check_llm.probe(离线)",    lambda: check_llm.probe("http://127.0.0.1:1/v1/chat/completions", "k", "m"))


def _driver_ego_env():
    old_chrome = os.environ.get("CHROME_BIN")
    old_pw = os.environ.get("PLAYWRIGHT_BROWSERS_PATH")
    old_task = os.environ.get("EGO_TASK_SPACE")
    old_llm = os.environ.get("LLM_CONFIG")
    old_here = driver.HERE
    try:
        os.environ["CHROME_BIN"] = "/forbidden/chrome"
        os.environ["PLAYWRIGHT_BROWSERS_PATH"] = "/forbidden/playwright"
        os.environ["EGO_TASK_SPACE"] = "test-ego-space"
        os.environ["LLM_CONFIG"] = "/tmp/llm.json"
        env = driver.agent_env()
        if "CHROME_BIN" in env or "PLAYWRIGHT_BROWSERS_PATH" in env:
            raise AssertionError("driver leaked a forbidden browser path")
        if env.get("EGO_TASK_SPACE") != "test-ego-space":
            raise AssertionError("driver did not preserve the Ego task space")
        bridged = driver.ego_agent_environment(env)
        if bridged.get("LLM_CONFIG") != "/tmp/llm.json" or "CHROME_BIN" in bridged:
            raise AssertionError("driver built an invalid Ego environment bridge")
        from pathlib import Path
        import stat
        driver.HERE = Path(D) / "ego-driver"
        env["LLM_API_KEY"] = "fake-secret"
        env_file = driver.write_ego_environment(env)
        try:
            if stat.S_IMODE(env_file.stat().st_mode) != 0o600:
                raise AssertionError("Ego environment file is not 0600")
            source = driver.ego_agent_script(["https://example.com"], "test-ego-space", env_file)
            if "fake-secret" in source:
                raise AssertionError("Ego launcher source leaked the API key")
        finally:
            env_file.unlink(missing_ok=True)
    finally:
        driver.HERE = old_here
        for key, value in (("CHROME_BIN", old_chrome),
                           ("PLAYWRIGHT_BROWSERS_PATH", old_pw),
                           ("EGO_TASK_SPACE", old_task),
                           ("LLM_CONFIG", old_llm)):
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


t("driver 只传 Ego 环境", _driver_ego_env)

# 审计写失败不该让已完成的状态迁移作废(js 侧有同名断言,py 侧不能少)
def _audit_fail_keeps_state():
    import json as _json
    import subprocess as _sp
    import tempfile as _tf
    d = _tf.mkdtemp()
    os.makedirs(os.path.join(d, "events.jsonl"), exist_ok=True)   # events 变目录 → 写必失败
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    code = ("import sys;sys.path.insert(0,%r);import state;"
            "r=state.upsert_submission('a.com','blocked',source='t');"
            "print('OK' if r['written'] and state.current_status('a.com')['status']=='blocked' else 'LOST')" % here)
    out = _sp.run([sys.executable, "-c", code], env={**os.environ, "OUTREACH_STATE_DIR": d},
                  capture_output=True, text=True)
    got = (out.stdout or "").strip()
    if got != "OK":
        raise AssertionError(f"events 写不进时状态迁移被作废了(stdout={got!r} stderr={(out.stderr or '')[:120]})")

t("审计写失败不作废状态迁移", _audit_fail_keeps_state)

bad = [r for r in res if not r[0]]
for good, name, err in res:
    if not good:
        print(f"   ❌ {name} → {err}")
print(f"   {len(res) - len(bad)}/{len(res)} 通过" + (" ✅" if not bad else ""))
sys.exit(1 if bad else 0)
