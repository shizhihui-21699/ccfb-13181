import { define } from "../../utils.ts";
import { Field, Notice, PageHeader } from "../../components/ui.tsx";
import { hashPassword, verifyPassword } from "../../lib/crypto.ts";
import * as repo from "../../lib/repo.ts";
import { staffOrRedirect } from "../../lib/auth.ts";

export const handler = define.handlers({
  GET(ctx) {
    const auth = staffOrRedirect(ctx);
    if (auth instanceof Response) return auth;
    return {
      data: {
        staff: auth,
        force: ctx.url.searchParams.get("force") === "1" &&
          auth.must_change_password === 1,
        notice: ctx.url.searchParams.get("ok") ? "密码已更新。" : "",
        error: ctx.url.searchParams.get("err") ?? "",
      },
    };
  },

  async POST(ctx) {
    const auth = staffOrRedirect(ctx);
    if (auth instanceof Response) return auth;
    const staff = auth;

    let current = "";
    let next = "";
    let confirm = "";
    try {
      const form = await ctx.req.formData();
      current = String(form.get("current") ?? "");
      next = String(form.get("next") ?? "");
      confirm = String(form.get("confirm") ?? "");
    } catch {
      return ctx.redirect(
        "/staff/account?err=" + encodeURIComponent("内容无法解析。"),
      );
    }

    if (!verifyPassword(current, staff.password_hash)) {
      return ctx.redirect(
        "/staff/account?err=" + encodeURIComponent("当前密码不正确。"),
      );
    }
    if (next !== confirm) {
      return ctx.redirect(
        "/staff/account?err=" + encodeURIComponent("两次输入的新密码不一致。"),
      );
    }
    const check = checkPasswordStrength(next);
    if (check) {
      return ctx.redirect("/staff/account?err=" + encodeURIComponent(check));
    }

    repo.updateStaffPassword(staff.id, hashPassword(next));
    // 改密后强制所有旧会话失效，防止他人持有旧 Cookie 继续访问。
    repo.deleteSessionsForStaff(staff.id);
    repo.audit(staff.id, "account.password_change", staff.username);

    return ctx.redirect("/staff/login?changed=1");
  },
});

function checkPasswordStrength(pw: string): string | null {
  if (pw.length < 12) return "密码至少 12 位。";
  if (/^[a-z]+$/i.test(pw)) return "密码需要包含数字或符号。";
  if (/^(.)\1+$/.test(pw)) return "密码过于简单。";
  return null;
}

export default define.page<typeof handler>(function AccountPage({ data }) {
  return (
    <>
      <PageHeader
        title="我的账号"
        subtitle={`${data.staff.display_name} · ${data.staff.username}`}
      />
      {data.force && (
        <Notice kind="warn" title="请先修改初始密码">
          在修改密码之前，你无法使用工作台的其他功能。
        </Notice>
      )}
      {data.notice && <Notice kind="ok">{data.notice}</Notice>}
      {data.error && <Notice kind="danger">{data.error}</Notice>}

      <form class="card" method="post" action="/staff/account">
        <h2 style="margin-top:0">修改密码</h2>
        <Field label="当前密码" required>
          <input
            type="password"
            name="current"
            autocomplete="current-password"
            required
          />
        </Field>
        <Field label="新密码" required hint="至少 12 位，包含数字或符号。">
          <input
            type="password"
            name="next"
            autocomplete="new-password"
            required
            minlength={12}
          />
        </Field>
        <Field label="再次输入新密码" required>
          <input
            type="password"
            name="confirm"
            autocomplete="new-password"
            required
            minlength={12}
          />
        </Field>
        <div class="btn-row">
          <button class="btn" type="submit">更新密码</button>
        </div>
      </form>

      <Notice kind="info" title="账号信息">
        <dl class="kv">
          <dt>角色</dt>
          <dd>{data.staff.role}</dd>
          <dt>上次登录</dt>
          <dd>{data.staff.last_login_at ?? "—"}</dd>
        </dl>
      </Notice>
    </>
  );
});
