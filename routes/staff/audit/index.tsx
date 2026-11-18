import { define } from "../../../utils.ts";
import { EmptyState, formatTime, PageHeader } from "../../../components/ui.tsx";
import * as repo from "../../../lib/repo.ts";
import { can, staffOrRedirect } from "../../../lib/auth.ts";

const ACTION_LABELS: Record<string, string> = {
  login: "登录",
  login_failed: "登录失败",
  logout: "退出登录",
  "case.assign": "分派案件",
  "case.unassign": "取消分派",
  "case.status": "变更案件状态",
  "case.message_reporter": "向举报人发送消息",
  "case.internal_note": "添加内部备注",
  "attachment.download": "下载附件",
  "staff.create": "创建账号",
  "staff.enable": "启用账号",
  "staff.disable": "停用账号",
  "staff.password_reset": "重置账号密码",
  "account.password_change": "修改自己的密码",
  "audit.export": "导出审计日志",
};

export const handler = define.handlers({
  GET(ctx) {
    const auth = staffOrRedirect(ctx);
    if (auth instanceof Response) return auth;
    if (!can(auth, "view_audit")) {
      return new Response("无权访问", { status: 403 });
    }

    const rows = repo.listAudit(300);
    const actorFilter = ctx.url.searchParams.get("actor") ?? "";
    const filtered = actorFilter
      ? rows.filter((r) => r.actor_id === actorFilter)
      : rows;

    return {
      data: {
        me: auth,
        rows: filtered,
        actors: repo.listStaff(),
        actorFilter,
        canExport: can(auth, "export_audit"),
      },
    };
  },
});

export default define.page<typeof handler>(function AuditPage({ data }) {
  return (
    <>
      <PageHeader
        title="审计日志"
        subtitle="记录员工侧的敏感操作。举报人侧不存在任何可记录的身份信息。"
      />

      <form class="filters" method="get" action="/staff/audit">
        <div class="f">
          <label for="a-actor">操作人</label>
          <select id="a-actor" name="actor">
            <option value="">全部</option>
            {data.actors.map((s) => (
              <option value={s.id} selected={data.actorFilter === s.id}>
                {s.display_name}
              </option>
            ))}
          </select>
        </div>
        <button class="btn secondary" type="submit">筛选</button>
        {data.canExport && (
          <a class="btn ghost" href="/staff/audit/export">导出 CSV</a>
        )}
      </form>

      {data.rows.length === 0
        ? <EmptyState title="暂无记录">还没有发生可审计的操作。</EmptyState>
        : (
          <div class="card tight" style="padding:0">
            <div class="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>操作人</th>
                    <th>动作</th>
                    <th>对象</th>
                    <th>详情</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr>
                      <td class="small mono">{formatTime(r.created_at)}</td>
                      <td class="small">
                        {r.actor_name ?? <span class="muted">—</span>}
                      </td>
                      <td class="small">
                        {ACTION_LABELS[r.action] ?? r.action}
                      </td>
                      <td class="small mono">{r.target ?? "—"}</td>
                      <td class="small muted">{r.detail ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      <p class="tiny muted" style="margin-top:14px">
        审计日志本身不记录 IP、User-Agent
        或设备信息，因此无法用于反查员工的工作环境。
      </p>
    </>
  );
});
