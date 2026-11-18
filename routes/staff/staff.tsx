import { define } from "../../utils.ts";
import { Field, Notice, PageHeader } from "../../components/ui.tsx";
import * as repo from "../../lib/repo.ts";
import { can, staffOrRedirect } from "../../lib/auth.ts";
import { hashPassword, randomToken } from "../../lib/crypto.ts";
import { ROLE_LABELS } from "../../lib/config.ts";

const ROLES: repo.StaffRole[] = ["investigator", "lead", "auditor", "admin"];

export const handler = define.handlers({
  GET(ctx) {
    const auth = staffOrRedirect(ctx);
    if (auth instanceof Response) return auth;
    if (!can(auth, "manage_staff")) {
      return new Response("无权访问", { status: 403 });
    }

    return {
      data: {
        me: auth,
        staff: repo.listStaff(),
        notice: ctx.url.searchParams.get("ok") ?? "",
        error: ctx.url.searchParams.get("err") ?? "",
        // 新建账号的初始密码只在这一次显示，不落库、不回显。
        created: ctx.url.searchParams.get("created") ?? "",
        createdName: ctx.url.searchParams.get("name") ?? "",
      },
    };
  },

  async POST(ctx) {
    const auth = staffOrRedirect(ctx);
    if (auth instanceof Response) return auth;
    if (!can(auth, "manage_staff")) {
      return new Response("无权访问", { status: 403 });
    }

    let action = "";
    let username = "";
    let displayName = "";
    let role = "";
    let staffId = "";
    let active = "";
    try {
      const form = await ctx.req.formData();
      action = String(form.get("action") ?? "");
      username = String(form.get("username") ?? "").trim();
      displayName = String(form.get("display_name") ?? "").trim();
      role = String(form.get("role") ?? "");
      staffId = String(form.get("staff_id") ?? "");
      active = String(form.get("active") ?? "");
    } catch {
      return ctx.redirect(
        "/staff/staff?err=" + encodeURIComponent("内容无法解析。"),
      );
    }

    if (action === "create") {
      if (!/^[a-z0-9._-]{3,32}$/i.test(username)) {
        return ctx.redirect(
          "/staff/staff?err=" +
            encodeURIComponent("用户名需为 3–32 位字母数字。"),
        );
      }
      if (!displayName) {
        return ctx.redirect(
          "/staff/staff?err=" + encodeURIComponent("请填写显示名。"),
        );
      }
      if (!ROLES.includes(role as repo.StaffRole)) {
        return ctx.redirect(
          "/staff/staff?err=" + encodeURIComponent("无效角色。"),
        );
      }
      if (repo.getStaffByUsername(username)) {
        return ctx.redirect(
          "/staff/staff?err=" + encodeURIComponent("用户名已存在。"),
        );
      }

      const initial = randomToken(12);
      repo.createStaff({
        username,
        displayName,
        role: role as repo.StaffRole,
        passwordHash: hashPassword(initial),
        mustChangePassword: true,
      });
      repo.audit(auth.id, "staff.create", username, role);

      const q = new URLSearchParams({
        ok: "账号已创建。",
        created: initial,
        name: username,
      });
      return ctx.redirect(`/staff/staff?${q}`);
    }

    if (action === "toggle") {
      const target = repo.getStaffById(staffId);
      if (!target) {
        return ctx.redirect(
          "/staff/staff?err=" + encodeURIComponent("账号不存在。"),
        );
      }
      if (target.id === auth.id) {
        return ctx.redirect(
          "/staff/staff?err=" + encodeURIComponent("不能停用自己的账号。"),
        );
      }
      // 防止把最后一个管理员停用，导致系统无人可管。
      if (target.role === "admin" && active !== "1") {
        const admins = repo.listStaff().filter((s) =>
          s.role === "admin" && s.active
        );
        if (admins.length <= 1) {
          return ctx.redirect(
            "/staff/staff?err=" +
              encodeURIComponent("至少保留一个启用中的管理员。"),
          );
        }
      }
      repo.setStaffActive(target.id, active === "1");
      repo.audit(
        auth.id,
        active === "1" ? "staff.enable" : "staff.disable",
        target.username,
      );
      return ctx.redirect(
        "/staff/staff?ok=" + encodeURIComponent("账号状态已更新。"),
      );
    }

    if (action === "reset") {
      const target = repo.getStaffById(staffId);
      if (!target) {
        return ctx.redirect(
          "/staff/staff?err=" + encodeURIComponent("账号不存在。"),
        );
      }
      const newPw = randomToken(12);
      repo.updateStaffPassword(target.id, hashPassword(newPw));
      repo.deleteSessionsForStaff(target.id);
      repo.audit(auth.id, "staff.password_reset", target.username);
      const q = new URLSearchParams({
        ok: "密码已重置。",
        created: newPw,
        name: target.username,
      });
      return ctx.redirect(`/staff/staff?${q}`);
    }

    return ctx.redirect("/staff/staff?err=" + encodeURIComponent("未知操作。"));
  },
});

export default define.page<typeof handler>(function StaffAdminPage({ data }) {
  return (
    <>
      <PageHeader
        title="账号管理"
        subtitle="管理调查员、合规负责人、审计员与管理员账号。"
      />
      {data.notice && <Notice kind="ok">{data.notice}</Notice>}
      {data.error && <Notice kind="danger">{data.error}</Notice>}

      {data.created && (
        <Notice
          kind="warn"
          title={`${data.createdName} 的初始密码（只显示这一次）`}
        >
          <p class="mono" style="font-size:18px;margin:6px 0">{data.created}</p>
          请通过安全渠道交给本人。对方首次登录后必须修改。
        </Notice>
      )}

      <div class="card tight" style="padding:0">
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>用户名</th>
                <th>显示名</th>
                <th>角色</th>
                <th>状态</th>
                <th>上次登录</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {data.staff.map((s) => (
                <tr>
                  <td class="mono small">{s.username}</td>
                  <td>{s.display_name}</td>
                  <td class="small">{ROLE_LABELS[s.role]}</td>
                  <td>
                    <span
                      class={`badge ${s.active ? "investigating" : "closed"}`}
                    >
                      {s.active ? "启用" : "停用"}
                    </span>
                  </td>
                  <td class="small mono">
                    {s.last_login_at?.slice(0, 16).replace("T", " ") ?? "—"}
                  </td>
                  <td>
                    <div style="display:flex;gap:6px;flex-wrap:wrap">
                      <form method="post" action="/staff/staff">
                        <input type="hidden" name="action" value="toggle" />
                        <input type="hidden" name="staff_id" value={s.id} />
                        <input
                          type="hidden"
                          name="active"
                          value={s.active ? "0" : "1"}
                        />
                        <button
                          class="btn ghost small"
                          type="submit"
                          style="padding:4px 10px;font-size:13px"
                        >
                          {s.active ? "停用" : "启用"}
                        </button>
                      </form>
                      <form
                        method="post"
                        action="/staff/staff"
                        data-confirm="重置该账号密码？对方现有会话会立即失效。"
                      >
                        <input type="hidden" name="action" value="reset" />
                        <input type="hidden" name="staff_id" value={s.id} />
                        <button
                          class="btn ghost small"
                          type="submit"
                          style="padding:4px 10px;font-size:13px"
                        >
                          重置密码
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <form class="card" method="post" action="/staff/staff">
        <input type="hidden" name="action" value="create" />
        <h2 style="margin-top:0">新建账号</h2>
        <div class="grid-2">
          <Field label="用户名" required hint="字母数字，用于登录。">
            <input type="text" name="username" required maxlength={32} />
          </Field>
          <Field label="显示名" required hint="在案件时间线与留言中显示。">
            <input type="text" name="display_name" required maxlength={60} />
          </Field>
        </div>
        <Field label="角色" required>
          <select name="role" required>
            <option value="investigator">调查员 — 办理分派给自己的案件</option>
            <option value="lead">合规负责人 — 分派、结案、查看全部</option>
            <option value="auditor">审计员 — 只读监督</option>
            <option value="admin">平台管理员 — 账号与系统，不看案件内容</option>
          </select>
        </Field>
        <div class="btn-row">
          <button class="btn" type="submit">创建账号</button>
        </div>
      </form>

      <Notice kind="info" title="权限模型">
        <ul>
          <li>
            <b>调查员</b>：只能看到分派给自己的案件。
          </li>
          <li>
            <b>合规负责人</b>：全量案件、分派、状态变更、结案。
          </li>
          <li>
            <b>审计员</b>：只读，用于监督合规组自身的操作。
          </li>
          <li>
            <b>平台管理员</b>：管账号与系统，<b>
              看不到案件正文
            </b>，也无法给举报人留言。
          </li>
        </ul>
      </Notice>
    </>
  );
});
