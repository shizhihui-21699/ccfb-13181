import { define } from "../../utils.ts";
import {
  formatBytes,
  Notice,
  PageHeader,
  severityLabel,
  StatusBadge,
  statusDesc,
} from "../../components/ui.tsx";
import { categoryLabel } from "../../components/ui.tsx";
import * as repo from "../../lib/repo.ts";

interface CaseView {
  caseNumber: string;
  category: string;
  severity: string;
  status: string;
  subject: string;
  body: string;
  submittedDay: string;
  wantsUpdate: boolean;
  messages: repo.MessageRow[];
  attachments: repo.AttachmentRow[];
  notice: string;
}

export const handler = define.handlers({
  GET(ctx) {
    const c = ctx.state.reporter;
    if (!c) return ctx.redirect("/track");

    const messages = repo.listReporterMessages(c.id);
    const attachments = repo.listAttachments(c.id);
    return {
      data: {
        caseNumber: c.case_number,
        category: c.category,
        severity: c.severity,
        status: c.status,
        subject: c.subject,
        body: c.body,
        submittedDay: c.submitted_day,
        wantsUpdate: c.reporter_wants_update === 1,
        messages,
        attachments,
        notice: ctx.url.searchParams.get("sent")
          ? "已提交。调查人员会在查看后回复。"
          : ctx.url.searchParams.get("withdrawn")
          ? "案件已撤回。"
          : "",
      } satisfies CaseView,
    };
  },
});

export default define.page<typeof handler>(function CasePage({ data }) {
  const closed = ["closed", "withdrawn", "resolved"].includes(data.status);

  return (
    <>
      <PageHeader title={data.subject}>
        <p class="muted">
          案件编号 <span class="mono">{data.caseNumber}</span> · 提交于{" "}
          {data.submittedDay}（只记录日期）
        </p>
      </PageHeader>

      {data.notice && <Notice kind="ok">{data.notice}</Notice>}

      <div class="grid-side">
        <div>
          <div class="card">
            <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
              <StatusBadge status={data.status} />
              <span class="badge">{categoryLabel(data.category)}</span>
              <span class={`badge sev-${data.severity}`}>
                {severityLabel(data.severity)}
              </span>
            </div>
            <p class="muted small" style="margin-top:0">
              {statusDesc(data.status)}
            </p>
            <h3>你提交的内容</h3>
            <div class="bubble reporter" style="max-width:100%">
              <div class="body">{data.body}</div>
            </div>
            {data.attachments.length > 0 && (
              <>
                <h3>附件（{data.attachments.length}）</h3>
                <ul class="attach-list">
                  {data.attachments.map((a) => (
                    <li>
                      <a href={`/case/attachments/${a.id}`}>
                        {a.content_type.split("/")[0] === "image"
                          ? "图片"
                          : a.content_type === "application/pdf"
                          ? "PDF 文档"
                          : "文本"}
                        · {formatBytes(a.size_bytes)}
                      </a>
                      <span class="tiny muted">· 上传于 {a.created_day}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <div class="card">
            <h2 style="margin-top:0">与调查组的往来</h2>
            {data.messages.length === 0 && (
              <p class="muted small">
                还没有消息。调查人员受理后会在这里留言。你随时可以补充材料。
              </p>
            )}
            <div class="thread">
              {data.messages.map((m) => (
                <div class={`bubble ${m.direction}`}>
                  <div class="meta">
                    <b>{m.direction === "reporter" ? "你" : "调查组"}</b>
                    <span>
                      {m.direction === "reporter"
                        ? m.created_day
                        : m.created_at?.slice(0, 16).replace("T", " ")}
                    </span>
                  </div>
                  <div class="body">{m.body}</div>
                </div>
              ))}
            </div>

            {!closed && (
              <form
                method="post"
                action="/case/reply"
                enctype="multipart/form-data"
                style="margin-top:20px;border-top:1px solid #eceef2;padding-top:16px"
              >
                <label class="field" for="reply-body">
                  补充说明或回复调查组
                </label>
                <p class="hint">
                  不要写自己的姓名、电话或邮箱——那会让匿名失效。只写调查需要的事实。
                </p>
                <textarea
                  id="reply-body"
                  name="body"
                  placeholder="补充材料、回答调查组的问题…"
                >
                </textarea>
                <label class="field" for="reply-file">附件（可选）</label>
                <input
                  id="reply-file"
                  type="file"
                  name="attachment"
                  multiple
                  accept=".png,.jpg,.jpeg,.webp,.pdf,.txt,image/png,image/jpeg,image/webp,application/pdf,text/plain"
                />
                <div class="btn-row">
                  <button class="btn" type="submit">发送</button>
                </div>
              </form>
            )}
          </div>
        </div>

        <aside>
          <div class="card tight">
            <h3 style="margin-top:0">案件状态</h3>
            <p class="small" style="margin:0">{statusDesc(data.status)}</p>
            <h3>你的凭据</h3>
            <p class="small muted" style="margin:0">
              你已通过凭据验证，本次会话 24
              小时后失效。离开公共电脑时请点下方退出。
            </p>
            <div class="btn-row" style="margin-top:14px">
              <form method="post" action="/case/logout">
                <button class="btn ghost" type="submit">退出</button>
              </form>
            </div>
          </div>

          {!closed && (
            <div class="card tight">
              <h3 style="margin-top:0">撤回举报</h3>
              <p class="small muted">
                只有你能撤回。撤回后案件不再出现在调查队列，但已收到的内容会保留用于
                合规审计。此操作不可撤销。
              </p>
              <form
                method="post"
                action="/case/withdraw"
                data-confirm="确定撤回这份举报？此操作不可撤销。"
              >
                <button class="btn danger" type="submit">撤回举报</button>
              </form>
            </div>
          )}

          <Notice kind="info" title="隐私提醒">
            本页面不记录你的访问时间（只有你要发送的消息按天记录）。若有人要求你「打开系统证明你没举报」，这类要求本身可能已构成打击报复，请一并举报。
          </Notice>
        </aside>
      </div>
    </>
  );
});
