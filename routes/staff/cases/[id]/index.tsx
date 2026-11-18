import { define } from "../../../../utils.ts";
import {
  categoryLabel,
  formatBytes,
  formatTime,
  PageHeader,
  severityLabel,
  StatusBadge,
  statusDesc,
} from "../../../../components/ui.tsx";
import * as repo from "../../../../lib/repo.ts";
import { can, canAccessCase, staffOrRedirect } from "../../../../lib/auth.ts";
import { STATUSES } from "../../../../lib/config.ts";

/** 没有员工 actor 的事件是举报人触发的，时间只精确到天，显示时不要伪装成时刻。 */
function eventTime(iso: string): string {
  return iso.endsWith("T00:00:00.000Z")
    ? `${iso.slice(0, 10)}（按天记录）`
    : formatTime(iso);
}

const EVENT_LABELS: Record<string, string> = {
  created: "举报提交",
  assigned: "分派给调查员",
  unassigned: "取消分派",
  status: "状态变更",
  reporter_message: "举报人补充材料",
  reporter_replied: "举报人回复（状态回到调查中）",
  staff_message: "向举报人发送消息",
  internal_note: "内部备注",
  withdrawn: "举报人撤回",
};

export const handler = define.handlers({
  GET(ctx) {
    const auth = staffOrRedirect(ctx);
    if (auth instanceof Response) return auth;
    const staff = auth;

    const caseRow = repo.getCaseById(ctx.params.id);
    // 不存在与无权限返回同一结果，避免用 ID 探测案件是否存在。
    if (!caseRow || !canAccessCase(staff, caseRow, "view_case")) {
      return new Response("未找到", { status: 404 });
    }

    const messages = repo.listStaffMessages(caseRow.id);
    const attachments = repo.listAttachments(caseRow.id);
    const events = repo.listCaseEvents(caseRow.id);
    const staffById = new Map(repo.listStaff().map((s) => [s.id, s]));

    const canAssign = can(staff, "assign_case");
    const assignable = canAssign
      ? repo.listStaff().filter((s) =>
        s.active && (s.role === "investigator" || s.role === "lead")
      )
      : [];

    return {
      data: {
        staff,
        caseRow,
        messages,
        attachments,
        events,
        staffById,
        assignable,
        canAssign,
        canStatus: canAccessCase(staff, caseRow, "change_status"),
        canMessage: canAccessCase(staff, caseRow, "message_reporter"),
        canDownload: canAccessCase(staff, caseRow, "download_attachment"),
        notice: ctx.url.searchParams.get("ok") ?? "",
        error: ctx.url.searchParams.get("err") ?? "",
      },
    };
  },
});

export default define.page<typeof handler>(function CaseDetail({ data }) {
  const c = data.caseRow;
  const closed = ["closed", "withdrawn"].includes(c.status);
  const authorName = (id: string | null) =>
    id ? (data.staffById.get(id)?.display_name ?? "已删除账号") : "系统";

  return (
    <>
      <PageHeader title={c.subject}>
        <p class="muted">
          <span class="mono">{c.case_number}</span> · 提交于{" "}
          <span class="mono">{c.submitted_day}</span> · 类别{" "}
          {categoryLabel(c.category)} · 严重度 {severityLabel(c.severity)}
        </p>
      </PageHeader>

      {data.notice && <div class="notice ok">{data.notice}</div>}
      {data.error && <div class="notice danger">{data.error}</div>}

      <div class="grid-side">
        <div>
          <div class="card">
            <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
              <StatusBadge status={c.status} />
              <span class={`badge sev-${c.severity}`}>
                {severityLabel(c.severity)}
              </span>
              <span class="muted small">{statusDesc(c.status)}</span>
            </div>
            <h3 style="margin-top:16px">举报正文</h3>
            <div style="white-space:pre-wrap;word-break:break-word;font-size:15px;background:#fafbfc;border:1px solid #eceef2;border-radius:8px;padding:14px 16px">
              {c.body}
            </div>

            <h3>附件（{data.attachments.length}）</h3>
            {data.attachments.length === 0
              ? <p class="muted small">无附件。</p>
              : (
                <ul class="attach-list">
                  {data.attachments.map((a) => (
                    <li>
                      {data.canDownload
                        ? (
                          <a href={`/staff/attachments/${a.id}`}>
                            {a.content_type === "application/pdf"
                              ? "PDF 文档"
                              : a.content_type.startsWith("image/")
                              ? "图片"
                              : "文本"}
                          </a>
                        )
                        : <span>{a.content_type}</span>}
                      <span class="tiny muted">
                        {formatBytes(a.size_bytes)} · sha256{" "}
                        {a.sha256.slice(0, 12)}…
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            <p class="tiny muted" style="margin-top:10px">
              附件已清除元数据并加密存储。原始文件名不保留。下载动作会记入审计日志。
            </p>
          </div>

          <div class="card">
            <h2 style="margin-top:0">沟通记录</h2>
            {data.messages.length === 0 && (
              <p class="muted small">暂无往来。</p>
            )}
            <div class="thread">
              {data.messages.map((m) => (
                <div
                  class={`bubble ${m.direction} ${
                    m.internal_only ? "internal" : ""
                  }`}
                >
                  <div class="meta">
                    <b>
                      {m.direction === "reporter"
                        ? "举报人"
                        : `${authorName(m.author_id)}${
                          m.internal_only ? "（内部备注，举报人不可见）" : ""
                        }`}
                    </b>
                    <span>
                      {m.direction === "reporter"
                        ? m.created_day
                        : formatTime(m.created_at)}
                    </span>
                  </div>
                  <div class="body">{m.body}</div>
                </div>
              ))}
            </div>

            {data.canMessage && !closed && (
              <form
                method="post"
                action={`/staff/cases/${c.id}/message`}
                style="margin-top:20px;border-top:1px solid #eceef2;padding-top:16px"
              >
                <label class="field" for="m-body">发送消息</label>
                <p class="hint">
                  发给举报人的消息会出现在其案件页。内部备注只有调查组可见。
                  请勿在消息里要求举报人提供姓名、工号或联系方式。
                </p>
                <textarea
                  id="m-body"
                  name="body"
                  required
                  placeholder="向举报人提问，或告知进展…"
                >
                </textarea>
                <div class="radio-row" style="margin-top:10px">
                  <label>
                    <input
                      type="radio"
                      name="visibility"
                      value="reporter"
                      checked
                    />
                    <span>
                      发给举报人<span class="sub">
                        对方会在案件页看到，并收到「等待补充」状态
                      </span>
                    </span>
                  </label>
                  <label>
                    <input type="radio" name="visibility" value="internal" />
                    <span>
                      内部备注<span class="sub">仅调查组可见</span>
                    </span>
                  </label>
                </div>
                <div class="btn-row">
                  <button class="btn" type="submit">发送</button>
                </div>
              </form>
            )}
          </div>
        </div>

        <aside>
          {data.canAssign && (
            <div class="card tight">
              <h3 style="margin-top:0">分派</h3>
              <p class="small muted">
                当前：{c.assigned_to
                  ? data.staffById.get(c.assigned_to)?.display_name ?? "—"
                  : "未分派"}
              </p>
              <form method="post" action={`/staff/cases/${c.id}/assign`}>
                <select name="assignee" style="margin-bottom:10px">
                  <option value="">— 取消分派 —</option>
                  {data.assignable.map((s) => (
                    <option value={s.id} selected={c.assigned_to === s.id}>
                      {s.display_name}（{s.role === "lead"
                        ? "负责人"
                        : "调查员"}）
                    </option>
                  ))}
                </select>
                <button class="btn secondary" type="submit" style="width:100%">
                  保存分派
                </button>
              </form>
            </div>
          )}

          {data.canStatus && (
            <div class="card tight">
              <h3 style="margin-top:0">状态</h3>
              <form method="post" action={`/staff/cases/${c.id}/status`}>
                <select name="status" style="margin-bottom:10px">
                  {STATUSES.map((s) => (
                    <option value={s.value} selected={c.status === s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <button class="btn secondary" type="submit" style="width:100%">
                  更新状态
                </button>
              </form>
              <p class="tiny muted" style="margin-top:10px">
                设为「等待你补充」时，系统会把案件标记为等待举报人，并在对方回复后自动回到「调查中」。
              </p>
            </div>
          )}

          <div class="card tight">
            <h3 style="margin-top:0">流转时间线</h3>
            <ul class="timeline">
              {data.events.map((e) => (
                <li>
                  {EVENT_LABELS[e.kind] ?? e.kind}
                  {e.detail && e.kind === "status"
                    ? `：${e.detail.split(":")[0]}`
                    : ""}
                  {e.actor_id ? ` · ${authorName(e.actor_id)}` : ""}
                  <time>{eventTime(e.created_at)}</time>
                </li>
              ))}
            </ul>
          </div>

          <div class="card tight">
            <h3 style="margin-top:0">匿名性核对</h3>
            <ul class="small muted" style="padding-left:18px;margin:0">
              <li>本系统没有举报人姓名、工号、联系方式。</li>
              <li>提交时间仅精确到天。</li>
              <li>请勿在内部备注之外的地方复制案件正文，避免扩散。</li>
            </ul>
          </div>
        </aside>
      </div>
    </>
  );
});
