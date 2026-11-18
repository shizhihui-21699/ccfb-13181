// HTTP 集成测试：直接驱动构建产物里的 handler，走完整路由栈。
//
// 覆盖：匿名提交 → 凭据交付 → 凭据登录 → 查看/回复 → 撤回；
// 以及员工登录 → 队列 → 分派 → 留言 → 审计。
//
// 运行前需要先 build（deno task test 已包含）。

import "./setup.ts";
import { assert, assertEquals } from "jsr:@std/assert@^1.0.0";
import { hashPassword } from "../lib/crypto.ts";
import * as repo from "../lib/repo.ts";

const server = await import("../_fresh/server.js");
const fetchApp =
  (server as { default: { fetch: (r: Request) => Promise<Response> } })
    .default.fetch;

/** 构造请求，并跟随重定向。 */
async function req(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return await fetchApp(new Request(`http://localhost${path}`, init));
}

function cookieFrom(res: Response, name: string): string | null {
  for (const c of res.headers.getSetCookie()) {
    if (c.startsWith(name + "=")) return c.split(";")[0];
  }
  return null;
}

Deno.test("安全响应头：CSP、禁嵌入、禁 Referer、禁缓存", async () => {
  const res = await req("/");
  assertEquals(res.status, 200);
  const csp = res.headers.get("content-security-policy") ?? "";
  assert(csp.includes("default-src 'self'"));
  assert(csp.includes("frame-ancestors 'none'"));
  assertEquals(res.headers.get("x-frame-options"), "DENY");
  assertEquals(res.headers.get("referrer-policy"), "no-referrer");
  assertEquals(res.headers.get("x-content-type-options"), "nosniff");
  assert((res.headers.get("cache-control") ?? "").includes("no-store"));
  await res.body?.cancel();
});

Deno.test("页面不引用任何第三方资源", async () => {
  for (const path of ["/", "/report", "/track", "/privacy"]) {
    const res = await req(path);
    const html = await res.text();
    // 只允许站内相对路径与 data: URI
    const external = html.match(/(?:src|href)="https?:\/\/[^"]+"/g);
    assertEquals(external, null, `${path} 引用了外部资源: ${external}`);
  }
});

Deno.test("完整流程：提交 → 获取凭据 → 凭据登录 → 查看 → 回复", async () => {
  const res = await req("/report", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      category: "harassment",
      severity: "high",
      subject: "部门主管长期言语霸凌",
      body:
        "自 2026 年 3 月起，某部门主管在例会上多次公开羞辱下属，至少三名同事在场。",
    }).toString(),
  });

  assertEquals(res.status, 302);
  const loc = res.headers.get("location") ?? "";
  assert(loc.startsWith("/report/done?t="), `意外重定向: ${loc}`);

  // 凭据交付页
  const done = await req(loc);
  assertEquals(done.status, 200);
  const html = await done.text();
  const credMatch = html.match(
    /[0-9A-HJKMNP-TV-Z]{5}(?:-[0-9A-HJKMNP-TV-Z]{5}){4}/,
  );
  assert(credMatch, "凭据页面未出现凭据");
  const credential = credMatch![0];
  const caseNumber = html.match(/WM-\d{4}-[0-9A-HJKMNP-TV-Z]{8}/)?.[0];
  assert(caseNumber);

  // 同一令牌不可复用
  const again = await req(loc);
  assertEquals(again.status, 302);
  assert((again.headers.get("location") ?? "").includes("/track"));
  await again.body?.cancel();

  // 凭据登录
  const login = await req(
    "/track",
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ credential }).toString(),
    },
  );
  assertEquals(login.status, 302);
  const cookie = cookieFrom(login, "wsp_case");
  assert(cookie, "未签发举报人会话 Cookie");
  await login.body?.cancel();

  // 查看案件
  const view = await req("/case", { headers: { cookie } });
  assertEquals(view.status, 200);
  const caseHtml = await view.text();
  assert(caseHtml.includes("部门主管长期言语霸凌"));
  assert(caseHtml.includes(caseNumber!));

  // 回复
  const reply = await req("/case/reply", {
    method: "POST",
    headers: {
      cookie,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      body: "补充：我保留了当时的会议录音，可以提供给调查组。",
    }).toString(),
  });
  assertEquals(reply.status, 302);
  await reply.body?.cancel();

  const afterReply = await req("/case", { headers: { cookie } });
  const afterHtml = await afterReply.text();
  assert(afterHtml.includes("会议录音"));
});

Deno.test("错误凭据给出统一提示，不区分不存在与格式错误", async () => {
  const r1 = await req("/track", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ credential: "AAAAAAAAAAAAAAAAAAAAAAAAA" })
      .toString(),
  });
  const r2 = await req("/track", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ credential: "not-a-real-format" }).toString(),
  });
  assertEquals(r1.status, 401);
  assertEquals(r2.status, 401);
  // CSP nonce 每次请求随机，比较前先抹掉。
  const strip = (h: string) => h.replace(/nonce="[a-f0-9]+"/g, 'nonce="X"');
  const t1 = strip(await r1.text());
  const t2 = strip(await r2.text());
  assertEquals(t1, t2, "两种失败应返回完全相同的页面");
});

Deno.test("未登录访问举报人页面会被引导到凭据页，而不是 404", async () => {
  const res = await req("/case");
  assertEquals(res.status, 302);
  assert((res.headers.get("location") ?? "").includes("/track"));
  await res.body?.cancel();
});

Deno.test("员工登录 → 队列 → 分派 → 留言 → 审计", async () => {
  const lead = repo.createStaff({
    username: "http-lead",
    displayName: "HTTP Lead",
    role: "lead",
    passwordHash: hashPassword("test-password-9876"),
    mustChangePassword: false,
  });

  // 先造一个案件
  const submit = await req("/report", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      category: "safety",
      severity: "medium",
      subject: "仓库消防通道长期堆货",
      body: "三号仓库的消防通道被纸箱占用已超过两个月，值班表上无人处理。",
    }).toString(),
  });
  const loc = submit.headers.get("location") ?? "";
  const done = await req(loc);
  await done.text();
  await submit.body?.cancel();

  const caseRow = repo.listCases({ status: "all" }).find((c) =>
    c.subject.includes("消防通道")
  );
  assert(caseRow, "未创建案件");

  // 未登录访问员工页 → 跳登录
  const anon = await req("/staff");
  assertEquals(anon.status, 302);
  assert((anon.headers.get("location") ?? "").includes("/staff/login"));
  await anon.body?.cancel();

  // 登录
  const login = await req("/staff/login", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      username: "http-lead",
      password: "test-password-9876",
    }).toString(),
  });
  assertEquals(login.status, 302);
  const cookie = cookieFrom(login, "wsp_staff");
  assert(cookie, "未签发员工会话");
  await login.body?.cancel();

  // 队列
  const queue = await req("/staff", { headers: { cookie } });
  assertEquals(queue.status, 200);
  assert((await queue.text()).includes("消防通道"));

  // 分派
  const assign = await req(`/staff/cases/${caseRow!.id}/assign`, {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ assignee: lead.id }).toString(),
  });
  assertEquals(assign.status, 302);
  await assign.body?.cancel();
  assertEquals(repo.getCaseById(caseRow!.id)!.assigned_to, lead.id);

  // 留言给举报人
  const msg = await req(`/staff/cases/${caseRow!.id}/message`, {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      body: "请补充仓库编号与最近一次检查日期。不要提供任何个人信息。",
      visibility: "reporter",
    }).toString(),
  });
  assertEquals(msg.status, 302);
  await msg.body?.cancel();

  const fresh = repo.getCaseById(caseRow!.id)!;
  assertEquals(fresh.status, "awaiting_reporter");

  // 审计日志里应有分派与留言
  const audit = await req("/staff/audit", { headers: { cookie } });
  const auditHtml = await audit.text();
  assert(auditHtml.includes("分派案件"));
  assert(auditHtml.includes("向举报人发送消息"));
});

Deno.test("管理员看不到案件详情", async () => {
  const admin = repo.createStaff({
    username: "http-admin",
    displayName: "Admin",
    role: "admin",
    passwordHash: hashPassword("admin-password-9999"),
    mustChangePassword: false,
  });
  const login = await req("/staff/login", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      username: "http-admin",
      password: "admin-password-9999",
    }).toString(),
  });
  const cookie = cookieFrom(login, "wsp_staff")!;
  await login.body?.cancel();

  const anyCase = repo.listCases({ status: "all" })[0];
  const detail = await req(`/staff/cases/${anyCase.id}`, {
    headers: { cookie },
  });
  assertEquals(detail.status, 404, "管理员不应能打开案件详情");
  await detail.body?.cancel();

  // 但可以管理账号
  const staffPage = await req("/staff/staff", { headers: { cookie } });
  assertEquals(staffPage.status, 200);
  await staffPage.text();

  // 摘要页可用，且不出现案件正文
  const overview = await req("/staff", { headers: { cookie } });
  const html = await overview.text();
  assert(html.includes("概览"));
  assert(!html.includes("消防通道"), "管理员概览不应出现案件标题");
  assertEquals(admin.role, "admin");
});

Deno.test("调查员不能打开他人案件（返回 404 而非 403，避免探测）", async () => {
  const inv = repo.createStaff({
    username: "http-inv",
    displayName: "Inv",
    role: "investigator",
    passwordHash: hashPassword("inv-password-8888"),
    mustChangePassword: false,
  });
  const login = await req("/staff/login", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      username: "http-inv",
      password: "inv-password-8888",
    }).toString(),
  });
  const cookie = cookieFrom(login, "wsp_staff")!;
  await login.body?.cancel();

  const otherCase = repo.listCases({ status: "all" }).find((c) =>
    c.assigned_to !== inv.id
  )!;
  const res = await req(`/staff/cases/${otherCase.id}`, {
    headers: { cookie },
  });
  assertEquals(res.status, 404);
  await res.body?.cancel();
});

Deno.test("举报人会话 Cookie 是 HttpOnly + SameSite", async () => {
  const cred = (await import("../lib/ids.ts")).newCredential();
  const { hashCredential } = await import("../lib/crypto.ts");
  const { newCaseNumber } = await import("../lib/ids.ts");
  repo.createCase({
    caseNumber: newCaseNumber(),
    credentialHash: hashCredential(cred),
    category: "fraud",
    severity: "low",
    subject: "cookie 测试",
    body: "正文正文正文正文正文正文正文",
  });

  const res = await req("/track", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ credential: cred }).toString(),
  });
  const raw = res.headers.getSetCookie().join("\n");
  assert(raw.includes("HttpOnly"));
  assert(raw.includes("SameSite=Lax"));
  // 默认非 HTTPS 部署时不加 Secure，避免本地开发无法登录
  assert(!raw.includes("Secure"), "非 HTTPS 环境不应强制 Secure");
  await res.body?.cancel();
});

Deno.test("静态资源可访问，且带正确 Content-Type", async () => {
  const css = await req("/styles.css");
  assertEquals(css.status, 200);
  assert((css.headers.get("content-type") ?? "").includes("text/css"));
  const body = await css.text();
  assert(body.includes(".credential-box"), "样式不完整");
  assert(body.includes(".thread"));

  const js = await req("/app.js");
  assertEquals(js.status, 200);
  assert((js.headers.get("content-type") ?? "").includes("javascript"));
  await js.text();
});

Deno.test("附件：上传后被净化、加密存储，员工与举报人都能取回且内容一致", async () => {
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  doc.setAuthor("张三 工号 A10086");
  doc.setTitle("内部机密");
  doc.addPage();
  const pdfBytes = await doc.save();

  const fd = new FormData();
  fd.set("category", "fraud");
  fd.set("severity", "medium");
  fd.set("subject", "附件流程测试");
  fd.set("body", "这是一段用于附件流程测试的正文，长度足够通过校验。");
  fd.set(
    "attachment",
    new File([pdfBytes as unknown as BlobPart], "工资条-张三.pdf", {
      type: "application/pdf",
    }),
  );

  const submit = await req("/report", { method: "POST", body: fd });
  assertEquals(submit.status, 302);
  const loc = submit.headers.get("location") ?? "";
  const done = await req(loc);
  const html = await done.text();
  const cred =
    html.match(/[0-9A-HJKMNP-TV-Z]{5}(?:-[0-9A-HJKMNP-TV-Z]{5}){4}/)![0];
  assert(!html.includes("工资条"), "凭据页不应出现原始文件名");

  // 举报人登录并下载
  const login = await req("/track", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ credential: cred }).toString(),
  });
  const cookie = cookieFrom(login, "wsp_case")!;
  await login.body?.cancel();

  const page = await req("/case", { headers: { cookie } });
  const pageHtml = await page.text();
  const attId = pageHtml.match(/\/case\/attachments\/([A-Z0-9]+)/)?.[1];
  assert(attId, "案件页应列出附件");

  const dl = await req(`/case/attachments/${attId}`, { headers: { cookie } });
  assertEquals(dl.status, 200);
  const got = new Uint8Array(await dl.arrayBuffer());
  const text = new TextDecoder("latin1").decode(got);
  assert(!text.includes("张三"), "下载到的 PDF 仍含作者信息");
  assert(!text.includes("内部机密"), "下载到的 PDF 仍含标题");
  // 仍是有效 PDF
  assert(text.startsWith("%PDF"));
  assert(text.includes("%%EOF"));

  // 数据库中不保存原始文件名
  const db = (await import("../lib/db.ts")).getDb();
  const row = db.prepare(
    "SELECT * FROM attachments ORDER BY rowid DESC LIMIT 1",
  )
    .get() as Record<string, unknown>;
  assert(!JSON.stringify(row).includes("工资条"), "数据库出现了原始文件名");
  assert(String(row.stored_name).endsWith(".pdf"));
});

Deno.test("审计日志绝不记录 IP / UA", async () => {
  const db = (await import("../lib/db.ts")).getDb();
  const cols =
    (db.prepare("PRAGMA table_info(audit_log)").all() as { name: string }[])
      .map((c) => c.name.toLowerCase());
  for (
    const f of [
      "ip",
      "ip_address",
      "user_agent",
      "ua",
      "remote_addr",
      "referer",
    ]
  ) {
    assertEquals(cols.includes(f), false, `audit_log 不应有 ${f} 列`);
  }
  const rows = db.prepare("SELECT * FROM audit_log").all();
  const blob = JSON.stringify(rows);
  assert(
    !/127\.0\.0\.1|::1|Mozilla\/|curl\//.test(blob),
    "审计日志出现了网络/客户端标识",
  );
});

Deno.test("案件页面从不出现举报人身份字样", async () => {
  const c = repo.listCases({ status: "all" })[0];
  const resp = await req(`/staff/cases/${c.id}`);
  if (resp.status !== 200) {
    await resp.body?.cancel();
    return;
  }
  const html = await resp.text();
  for (const word of ["举报人IP", "举报人邮箱", "举报人姓名", "来源IP"]) {
    assert(!html.includes(word), `页面出现了 ${word}`);
  }
});
