import { define } from "../../utils.ts";
import { Field, Notice, PageHeader } from "../../components/ui.tsx";
import { loginStaff, withCookies } from "../../lib/auth.ts";

export const handler = define.handlers({
  GET(ctx) {
    if (ctx.state.staff) return ctx.redirect("/staff");
    return { data: { error: "" } };
  },

  async POST(ctx) {
    let username = "";
    let password = "";
    try {
      const form = await ctx.req.formData();
      username = String(form.get("username") ?? "");
      password = String(form.get("password") ?? "");
    } catch {
      return { data: { error: "提交内容无法解析。" }, status: 400 };
    }

    const result = loginStaff(username, password);
    if (!result.ok) {
      const msg = result.reason === "locked"
        ? "登录失败次数过多，账号已临时锁定 15 分钟。"
        : "用户名或密码错误。";
      return { data: { error: msg }, status: 401 };
    }

    const { safeStaffNext } = await import("../../lib/auth.ts");
    const safe = safeStaffNext(ctx.url.searchParams.get("next"));
    const res = ctx.redirect(
      result.staff.must_change_password ? "/staff/account?force=1" : safe,
    );
    return withCookies(res, [result.cookie]);
  },
});

export default define.page<typeof handler>(function LoginPage({ data }) {
  return (
    <>
      <PageHeader
        title="调查工作台登录"
        subtitle="仅限合规、审计与平台管理员。举报人无需登录。"
      />
      {data.error && (
        <Notice kind="danger" title="登录失败">{data.error}</Notice>
      )}
      <form class="card" method="post" action="/staff/login">
        <Field label="用户名" required>
          <input
            type="text"
            name="username"
            autocomplete="username"
            required
            autofocus
          />
        </Field>
        <Field label="密码" required>
          <input
            type="password"
            name="password"
            autocomplete="current-password"
            required
          />
        </Field>
        <div class="btn-row">
          <button class="btn" type="submit">登录</button>
        </div>
      </form>
      <Notice kind="info" title="账号安全">
        首次登录会要求修改初始密码。连续 5 次失败将锁定 15
        分钟。你的登录与每一次案件操作都会记入审计日志。
      </Notice>
    </>
  );
});
