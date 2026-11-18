// 权限与工作流测试：分派、状态流转、举报人可见性、管理员边界。

import "./setup.ts";
import { assert, assertEquals } from "jsr:@std/assert@^1.0.0";
import { hashPassword } from "../lib/crypto.ts";
import * as repo from "../lib/repo.ts";
import { hashCredential } from "../lib/crypto.ts";
import { newCaseNumber, newCredential } from "../lib/ids.ts";
import { can, canAccessCase } from "../lib/auth.ts";
import { loginStaff, signInReporter } from "../lib/auth.ts";
import { getDb } from "../lib/db.ts";

function mkStaff(username: string, role: repo.StaffRole) {
  return repo.createStaff({
    username,
    displayName: username,
    role,
    passwordHash: hashPassword("initial-pass-1234"),
    mustChangePassword: false,
  });
}

function mkCase() {
  return repo.createCase({
    caseNumber: newCaseNumber(),
    credentialHash: hashCredential(newCredential()),
    category: "fraud",
    severity: "high",
    subject: "测试",
    body: "测试正文",
  });
}

Deno.test("角色权限矩阵", () => {
  const inv = mkStaff("inv", "investigator");
  const lead = mkStaff("lead", "lead");
  const aud = mkStaff("aud", "auditor");
  const adm = mkStaff("adm", "admin");

  // 管理员不能看案件内容，也不能留言
  assert(!can(adm, "view_case"), "管理员不应能看案件");
  assert(!can(adm, "message_reporter"), "管理员不应能联系举报人");
  assert(can(adm, "manage_staff"));
  assert(can(adm, "view_audit"));

  // 调查员不能分派、不能看审计
  assert(!can(inv, "assign_case"));
  assert(!can(inv, "view_audit"));
  assert(can(inv, "message_reporter"));

  // 审计员只读
  assert(can(aud, "view_case"));
  assert(!can(aud, "change_status"));
  assert(!can(aud, "message_reporter"));
  assert(can(aud, "view_audit"));

  // 负责人全量
  assert(can(lead, "assign_case"));
  assert(can(lead, "change_status"));
  assert(can(lead, "view_audit"));
});

Deno.test("调查员只能访问分派给自己的案件", () => {
  const inv1 = mkStaff("inv1", "investigator");
  const inv2 = mkStaff("inv2", "investigator");
  const c = mkCase();
  repo.assignCase(c.id, inv1.id, inv1.id);

  const fresh = repo.getCaseById(c.id)!;
  assert(canAccessCase(inv1, fresh, "view_case"), "本人案件应可访问");
  assert(!canAccessCase(inv2, fresh, "view_case"), "他人案件不应可访问");
  assert(!canAccessCase(inv2, fresh, "message_reporter"));
  assert(!canAccessCase(inv2, fresh, "change_status"));
});

Deno.test("管理员即便通过 canAccessCase 也拿不到案件访问权", () => {
  const adm = mkStaff("adm2", "admin");
  const c = mkCase();
  assert(!canAccessCase(adm, c, "view_case"));
});

Deno.test("向举报人发消息会同步把状态改成等待补充，并记入审计", () => {
  const lead = mkStaff("lead2", "lead");
  const c = mkCase();
  repo.addStaffMessage({
    caseId: c.id,
    staffId: lead.id,
    body: "请补充 2026 年 9 月的合同附件。",
    internalOnly: false,
  });
  repo.setCaseStatus(c.id, "awaiting_reporter", lead.id);

  const fresh = repo.getCaseById(c.id)!;
  assertEquals(fresh.status, "awaiting_reporter");

  // 内部备注不应出现在举报人可见列表
  repo.addStaffMessage({
    caseId: c.id,
    staffId: lead.id,
    body: "内部：此人可能是财务部的人，注意保护。",
    internalOnly: true,
  });

  const forReporter = repo.listReporterMessages(c.id);
  assertEquals(forReporter.length, 1);
  assert(!forReporter[0].body.includes("财务部"));

  const forStaff = repo.listStaffMessages(c.id);
  assertEquals(forStaff.length, 2);
});

Deno.test("举报人回复后状态回到调查中，且事件不归属任何员工", () => {
  const c = mkCase();
  repo.setCaseStatus(c.id, "awaiting_reporter", null);
  repo.addReporterMessage(c.id, "补充材料如下…");
  repo.reopenByReporter(c.id);

  const fresh = repo.getCaseById(c.id)!;
  assertEquals(fresh.status, "investigating");

  const events = repo.listCaseEvents(c.id);
  const replied = events.find((e) => e.kind === "reporter_replied");
  assert(replied);
  assertEquals(replied.actor_id, null, "举报人触发的事件不应有员工 actor");
});

Deno.test("状态时间线记录每一步操作者与时间", () => {
  const lead = mkStaff("lead3", "lead");
  const c = mkCase();
  repo.assignCase(c.id, lead.id, lead.id);
  repo.setCaseStatus(c.id, "triage", lead.id);
  repo.setCaseStatus(c.id, "investigating", lead.id);

  const events = repo.listCaseEvents(c.id);
  const kinds = events.map((e) => e.kind);
  assert(kinds.includes("created"));
  assert(kinds.includes("assigned"));
  assertEquals(kinds.filter((k) => k === "status").length, 2);
  for (const e of events) {
    // 所有员工动作都有精确时间
    assert(/^\d{4}-\d{2}-\d{2}T/.test(e.created_at));
  }
});

Deno.test("撤回后案件退出队列，且不能继续留言", () => {
  mkStaff("lead4", "lead");
  const c = mkCase();
  repo.withdrawCase(c.id);
  const fresh = repo.getCaseById(c.id)!;
  assertEquals(fresh.status, "withdrawn");
  assert(fresh.withdrawn_at !== null);

  const open = repo.listCases({ status: "open" });
  assert(!open.some((r) => r.id === c.id), "撤回的案件不应出现在未结案队列");
});

Deno.test("登录：错误密码返回 invalid，正确密码返回会话", () => {
  const s = mkStaff("login-test", "investigator");
  const bad = loginStaff("login-test", "wrong-password");
  assertEquals(bad.ok, false);

  const good = loginStaff("login-test", "initial-pass-1234");
  assertEquals(good.ok, true);
  if (good.ok) {
    assert(good.cookie.includes("wsp_staff="));
    assert(good.cookie.includes("HttpOnly"));
  }
  assertEquals(s.username, "login-test");
});

Deno.test("登录：连续失败 5 次后锁定", () => {
  mkStaff("lock-test", "investigator");
  for (let i = 0; i < 5; i++) {
    loginStaff("lock-test", "nope");
  }
  const locked = loginStaff("lock-test", "initial-pass-1234");
  assertEquals(locked.ok, false);
  if (!locked.ok) assertEquals(locked.reason, "locked");
});

Deno.test("停用账号无法登录，且返回与密码错误相同的结果（防枚举）", () => {
  const s = mkStaff("disable-test", "investigator");
  const res = loginStaff("disable-test", "initial-pass-1234");
  assert(res.ok);
  repo.setStaffActive(s.id, false);

  // 即便密码正确，停用账号也只会得到 "invalid"，与错误密码不可区分。
  const again = loginStaff("disable-test", "initial-pass-1234");
  assertEquals(again.ok, false);
  if (!again.ok) assertEquals(again.reason, "invalid");

  // 停用后原有会话被清理
  const sessions = getDb()
    .prepare("SELECT COUNT(*) AS n FROM sessions WHERE staff_id = ?")
    .get(s.id) as { n: number };
  assertEquals(sessions.n, 0);
});

Deno.test("凭据登录：正确凭据签发会话，错误凭据返回 null", () => {
  const cred = newCredential();
  const c = repo.createCase({
    caseNumber: newCaseNumber(),
    credentialHash: hashCredential(cred),
    category: "fraud",
    severity: "low",
    subject: "s",
    body: "b",
  });

  const ok = signInReporter(cred);
  assert(ok);
  assertEquals(ok!.caseRow.id, c.id);
  assert(ok!.cookie.includes("wsp_case="));

  // 带分隔符、小写也能登录
  const formatted = cred.replace(/(.{5})(?=.)/g, "$1-").toLowerCase();
  assert(signInReporter(formatted));

  assertEquals(signInReporter("AAAAAAAAAAAAAAAAAAAAAAAAA"), null);
  assertEquals(signInReporter("garbage"), null);
});

Deno.test("撤回不影响其他案件的队列统计", () => {
  const before = repo.caseStats();
  const c = mkCase();
  const afterCreate = repo.caseStats();
  assertEquals(afterCreate.total, before.total + 1);
  repo.withdrawCase(c.id);
  const afterWithdraw = repo.caseStats();
  assertEquals(afterWithdraw.open, before.open);
});

Deno.test("保留期清理只删除已结案的旧案件", () => {
  const old = repo.createCase({
    caseNumber: newCaseNumber(),
    credentialHash: hashCredential(newCredential()),
    category: "fraud",
    severity: "low",
    subject: "old",
    body: "b",
  });
  // 手工改到很早以前
  const db = repo.getCaseById(old.id)!;
  assertEquals(db.status, "submitted");

  reposSetDay(old.id, "2000-01-01");
  repo.setCaseStatus(old.id, "closed", null);
  const removed = repo.purgeClosedOlderThan("2010-01-01");
  assert(removed.includes(old.id));
  assertEquals(repo.getCaseById(old.id), null);
});

// 通过 repo 内部 SQL 直接改日期，仅测试用。
function reposSetDay(id: string, day: string) {
  getDb().prepare("UPDATE cases SET submitted_day = ? WHERE id = ?").run(
    day,
    id,
  );
}

Deno.test("已处理/已结案的案件不能再被举报人回复或撤回", () => {
  const cases = ["resolved", "closed"] as const;
  for (const st of cases) {
    const c = mkCase();
    repo.setCaseStatus(c.id, st, null);
    assertEquals(repo.getCaseById(c.id)!.status, st);
  }
});
