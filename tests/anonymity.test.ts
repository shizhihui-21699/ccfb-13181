// 匿名性核心不变量。这些测试是"承诺"的机器可验证版本。

import "./setup.ts";
import { assert, assertEquals, assertNotMatch } from "jsr:@std/assert@^1.0.0";
import {
  encodeBase32,
  formatCredential,
  newCaseNumber,
  newCredential,
  normalizeCredential,
} from "../lib/ids.ts";
import { getDb } from "../lib/db.ts";
import { hashCredential, hashPassword, verifyPassword } from "../lib/crypto.ts";
import * as repo from "../lib/repo.ts";
import { dayBucket } from "../lib/time.ts";

Deno.test("凭据：长度、熵与格式化", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i++) {
    const c = newCredential();
    assertEquals(c.length, 25);
    assert(/^[0-9A-HJKMNP-TV-Z]{25}$/.test(c), `非法字符: ${c}`);
    assert(!seen.has(c), "凭据重复");
    seen.add(c);
    const formatted = formatCredential(c);
    assertEquals(formatted.replaceAll("-", ""), c);
    assertEquals(normalizeCredential(formatted), c);
  }
});

Deno.test("凭据：规范化接受手抄歧义并对错误长度返回 null", () => {
  const c = newCredential();
  const lower = c.toLowerCase();
  assertEquals(normalizeCredential(lower), c);
  assertEquals(normalizeCredential(` ${lower} `), c);
  assertEquals(normalizeCredential("TOO-SHORT"), null);
  assertEquals(normalizeCredential(""), null);
  assertEquals(normalizeCredential("!@#$%^&*()"), null);
});

Deno.test("凭据：数据库只存哈希，不存明文", async () => {
  const { submitReport } = await import("../lib/service.ts");
  const res = await submitReport(
    {
      category: "fraud",
      severity: "medium",
      subject: "测试案件",
      body: "这是一段足够长的测试正文，用于验证数据库不会保存凭据明文。",
      uploads: [],
    },
    ["fraud"],
  );

  const db = getDb();
  const rows = db.prepare("SELECT * FROM cases").all();
  assertEquals(rows.length, 1);

  const serialized = JSON.stringify(rows);
  assert(
    !serialized.includes(res.credential),
    "数据库中出现了凭据明文！这是严重缺陷。",
  );
  assert(
    serialized.includes(hashCredential(res.credential)),
    "数据库中应有凭据哈希",
  );
});

Deno.test("案件表不存在任何举报人身份字段", () => {
  const db = getDb();
  const cols =
    (db.prepare("PRAGMA table_info(cases)").all() as { name: string }[])
      .map((c) => c.name.toLowerCase());

  const forbidden = [
    "ip",
    "ip_address",
    "user_agent",
    "ua",
    "email",
    "phone",
    "employee_id",
    "emp_no",
    "staff_no",
    "reporter_name",
    "reporter_email",
    "reporter_ip",
    "submitter",
    "device",
    "fingerprint",
    "session_ip",
    "referer",
    "referrer",
    "hostname",
    "mac",
  ];
  for (const f of forbidden) {
    assert(!cols.includes(f), `cases 表出现了禁止字段: ${f}`);
  }
});

Deno.test("消息表：举报人消息没有作者，且时间只到天", () => {
  const caseRow = repo.createCase({
    caseNumber: newCaseNumber(),
    credentialHash: hashCredential(newCredential()),
    category: "fraud",
    severity: "low",
    subject: "x",
    body: "y",
  });
  repo.addReporterMessage(caseRow.id, "举报人补充");

  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM messages WHERE case_id = ?")
    .all(caseRow.id) as Record<string, unknown>[];
  assertEquals(rows.length, 1);
  const m = rows[0];
  assertEquals(m.author_id, null);
  assert(m.created_day !== null, "举报人消息应有天级时间");
  assertEquals(m.created_at, null, "举报人消息不应有精确时间");
  // 天级时间不能包含时分秒
  assert(/^\d{4}-\d{2}-\d{2}$/.test(String(m.created_day)));
});

Deno.test("案件创建时的 created_at 归零到当天，不含精确时刻", () => {
  const caseRow = repo.createCase({
    caseNumber: newCaseNumber(),
    credentialHash: hashCredential(newCredential()),
    category: "safety",
    severity: "high",
    subject: "时间粒度测试",
    body: "正文",
  });
  assert(
    caseRow.created_at.endsWith("T00:00:00.000Z"),
    `created_at 应归零到当天，实际: ${caseRow.created_at}`,
  );
  assertEquals(caseRow.submitted_day, dayBucket());
});

Deno.test("员工操作时间保留精确值（员工不需要匿名）", () => {
  const staff = repo.createStaff({
    username: "timecheck",
    displayName: "Time",
    role: "lead",
    passwordHash: hashPassword("correct horse battery"),
  });
  const caseRow = repo.createCase({
    caseNumber: newCaseNumber(),
    credentialHash: hashCredential(newCredential()),
    category: "fraud",
    severity: "low",
    subject: "s",
    body: "b",
  });
  repo.addStaffMessage({
    caseId: caseRow.id,
    staffId: staff.id,
    body: "内部回复",
    internalOnly: false,
  });
  const db = getDb();
  const m = db
    .prepare("SELECT * FROM messages WHERE case_id = ? AND direction = 'staff'")
    .get(caseRow.id) as Record<string, unknown>;
  assert(m.created_at !== null);
  assert(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(m.created_at)),
    "员工消息应保留精确时间",
  );
  assertEquals(m.created_day, null);
});

Deno.test("密码哈希：可验证、不可逆、盐不同则哈希不同", () => {
  const pw = "a-very-long-password-42";
  const h1 = hashPassword(pw);
  const h2 = hashPassword(pw);
  assert(h1 !== h2, "相同密码应因盐不同产生不同哈希");
  assert(verifyPassword(pw, h1));
  assert(!verifyPassword("wrong", h1));
  assert(!h1.includes(pw));
});

Deno.test("base32 编码无偏置：固定输入得到确定输出", () => {
  assertEquals(encodeBase32(new Uint8Array([0, 0, 0, 0])), "0000000");
  const out = encodeBase32(new Uint8Array([255, 255, 255, 255, 255]));
  assert(/^[0-9A-HJKMNP-TV-Z]+$/.test(out));
});

Deno.test("案件编号不包含序号/时间以外的关联信息", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 500; i++) {
    const n = newCaseNumber();
    assert(/^WM-\d{4}-[0-9A-HJKMNP-TV-Z]{8}$/.test(n), n);
    assert(!seen.has(n));
    seen.add(n);
    assertNotMatch(n, /@|\.|:/);
  }
});

Deno.test("举报人触发的动作：案件事件、撤回时间都只到天", () => {
  const c = repo.createCase({
    caseNumber: newCaseNumber(),
    credentialHash: hashCredential(newCredential()),
    category: "fraud",
    severity: "low",
    subject: "时间粒度",
    body: "正文正文正文正文正文正文正文正文",
  });
  repo.addReporterMessage(c.id, "补充");
  repo.setCaseStatus(c.id, "awaiting_reporter", null);
  repo.reopenByReporter(c.id);
  repo.withdrawCase(c.id);

  const events = repo.listCaseEvents(c.id);
  for (const e of events) {
    assertEquals(
      e.actor_id,
      null,
      `举报人事件不应有员工 actor: ${e.kind}`,
    );
    assert(
      /T00:00:00\.000Z$/.test(e.created_at),
      `举报人事件时间未降级到天: ${e.kind} ${e.created_at}`,
    );
  }

  const fresh = repo.getCaseById(c.id)!;
  assert(
    fresh.withdrawn_at !== null &&
      fresh.withdrawn_at.endsWith("T00:00:00.000Z"),
    `撤回时间未降级: ${fresh.withdrawn_at}`,
  );
});

Deno.test("举报人会话的数据库记录不含精确时刻", async () => {
  const cred = newCredential();
  repo.createCase({
    caseNumber: newCaseNumber(),
    credentialHash: hashCredential(cred),
    category: "fraud",
    severity: "low",
    subject: "会话时间",
    body: "正文正文正文正文正文正文正文正文",
  });
  const { signInReporter } = await import("../lib/auth.ts");
  const s = signInReporter(cred)!;
  assert(s.cookie.length > 0);

  const row = getDb()
    .prepare("SELECT * FROM reporter_sessions ORDER BY rowid DESC LIMIT 1")
    .get() as Record<string, unknown>;
  assert(
    String(row.created_at).endsWith("T00:00:00.000Z"),
    `会话 created_at 未降级: ${row.created_at}`,
  );
  assert(
    String(row.expires_at).endsWith("T00:00:00.000Z"),
    `会话 expires_at 未按天锚定: ${row.expires_at}`,
  );
});
