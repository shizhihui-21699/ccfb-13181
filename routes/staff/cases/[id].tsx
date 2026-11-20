import { Handlers, PageProps } from "$fresh/server.ts";
import {
  addMessage,
  assignCase,
  CaseMessage,
  CaseStatus,
  getCase,
  listMessages,
  listStaffUsers,
  rateLimit,
  saveFile,
  setCaseStatus,
  StaffUser,
  STATUS_FLOW,
  STATUS_LABELS,
  WhistleCase,
} from "../../../lib/db.ts";
import {
  ALLOWED_FILE_TYPES,
  MAX_FILE_SIZE,
  sanitizeUpload,
} from "../../../lib/sanitize.ts";
import { redirect } from "../../../lib/session.ts";

interface Data {
  user: StaffUser;
  caseItem: WhistleCase;
  messages: CaseMessage[];
  staff: StaffUser[];
  error?: string;
}

async function load(
  ctx: Parameters<NonNullable<Handlers<Data>["GET"]>>[1],
  user: StaffUser,
) {
  const number = ctx.params.id.toUpperCase();
  const caseItem = await getCase(number);
  if (!caseItem) return null;
  const messages = await listMessages(number);
  const staff = user.role === "admin" ? await listStaffUsers() : [];
  return { user, caseItem, messages, staff };
}

export const handler: Handlers<Data> = {
  async GET(_req, ctx) {
    const user = ctx.state.user as StaffUser;
    const data = await load(ctx, user);
    if (!data) return new Response("Not found", { status: 404 });
    return ctx.render(data);
  },

  async POST(req, ctx) {
    const user = ctx.state.user as StaffUser;
    const number = ctx.params.id.toUpperCase();
    const form = await req.formData();
    const action = String(form.get("action") ?? "");

    if (action === "reply") {
      if (!(await rateLimit(`staffmsg:${user.username}`, 60, 60 * 60 * 1000))) {
        const data = await load(ctx, user);
        return ctx.render({ ...data!, error: "操作过于频繁,请稍后再试" }, {
          status: 429,
        });
      }
      const body = String(form.get("body") ?? "").trim();
      const file = form.get("file");
      const files: { id: string; name: string; size: number }[] = [];
      if (file instanceof File && file.size > 0) {
        if (file.size > MAX_FILE_SIZE || !ALLOWED_FILE_TYPES[file.type]) {
          const data = await load(ctx, user);
          return ctx.render({ ...data!, error: "附件类型不支持或超过 5MB" }, {
            status: 400,
          });
        }
        const sanitized = sanitizeUpload(
          file.type,
          new Uint8Array(await file.arrayBuffer()),
        );
        if (!sanitized) {
          const data = await load(ctx, user);
          return ctx.render({ ...data!, error: "图片文件损坏或格式异常" }, {
            status: 400,
          });
        }
        const meta = await saveFile({
          caseNumber: number,
          name: file.name,
          type: file.type,
          data: sanitized.data,
          metaStripped: sanitized.metaStripped,
        });
        files.push({ id: meta.id, name: meta.name, size: meta.size });
      }
      if (!body && files.length === 0) {
        const data = await load(ctx, user);
        return ctx.render({ ...data!, error: "请填写内容或选择附件" }, {
          status: 400,
        });
      }
      await addMessage({
        caseNumber: number,
        from: "staff",
        author: user.displayName,
        body,
        files,
      });
    } else if (action === "status") {
      const status = String(form.get("status") ?? "") as CaseStatus;
      if ((STATUS_FLOW as string[]).includes(status)) {
        await setCaseStatus(number, status);
      }
    } else if (action === "assign") {
      if (user.role !== "admin") {
        return new Response("Forbidden", { status: 403 });
      }
      const assignee = String(form.get("assignee") ?? "") || null;
      await assignCase(number, assignee);
    } else {
      return new Response("Bad request", { status: 400 });
    }

    return redirect(`/staff/cases/${encodeURIComponent(number)}`);
  },
};

export default function StaffCasePage({ data }: PageProps<Data>) {
  const { user, caseItem, messages, staff } = data;
  return (
    <main class="page wide">
      <header class="bar">
        <h1>{caseItem.title}</h1>
        <p class="muted">
          <a href="/staff">← 返回案件列表</a>
        </p>
      </header>

      <section class="card">
        <dl class="meta-grid">
          <div>
            <dt>案件编号</dt>
            <dd>
              <code>{caseItem.number}</code>
            </dd>
          </div>
          <div>
            <dt>类别</dt>
            <dd>{caseItem.category}</dd>
          </div>
          <div>
            <dt>提交日期</dt>
            <dd>{caseItem.day}</dd>
          </div>
          <div>
            <dt>状态</dt>
            <dd>
              <span class={`status status-${caseItem.status}`}>
                {STATUS_LABELS[caseItem.status]}
              </span>
            </dd>
          </div>
          <div>
            <dt>负责人</dt>
            <dd>{caseItem.assignee ?? "未分派"}</dd>
          </div>
        </dl>
        <h2>举报内容</h2>
        <p class="pre-wrap">{caseItem.description}</p>
      </section>

      <section class="card controls">
        <form method="post" class="inline-form">
          <input type="hidden" name="action" value="status" />
          <label>
            流转状态
            <select name="status">
              {STATUS_FLOW.map((s: CaseStatus) => (
                <option value={s} selected={caseItem.status === s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" class="btn">更新状态</button>
        </form>

        {user.role === "admin" && (
          <form method="post" class="inline-form">
            <input type="hidden" name="action" value="assign" />
            <label>
              分派给
              <select name="assignee">
                <option value="">未分派</option>
                {staff.map((s) => (
                  <option
                    value={s.username}
                    selected={caseItem.assignee === s.username}
                  >
                    {s.displayName}({s.username})
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" class="btn">分派</button>
          </form>
        )}
      </section>

      <section class="thread">
        <h2>沟通记录</h2>
        {messages.length === 0 && <p class="muted">暂无消息。</p>}
        {messages.map((m) => (
          <article class={`msg ${m.from}`}>
            <header>
              <strong>
                {m.from === "reporter"
                  ? "举报人(匿名)"
                  : m.author ?? "调查人员"}
              </strong>
              <time>{m.at}</time>
            </header>
            {m.body && <p class="pre-wrap">{m.body}</p>}
            {m.files.map((f: { id: string; name: string; size: number }) => (
              <p>
                <a href={`/files/${f.id}`}>📎 {f.name}</a>{" "}
                <span class="muted small">({Math.ceil(f.size / 1024)} KB)</span>
              </p>
            ))}
          </article>
        ))}
      </section>

      <section class="card">
        <h2>回复举报人</h2>
        {data.error && <div class="error-box">{data.error}</div>}
        <form method="post" enctype="multipart/form-data" class="form">
          <input type="hidden" name="action" value="reply" />
          <textarea
            name="body"
            rows={4}
            maxLength={5000}
            placeholder="向举报人提问或告知进展。对方只能看到“调查人员”,看不到你的姓名。"
          >
          </textarea>
          <input
            type="file"
            name="file"
            accept="image/jpeg,image/png,.pdf,.txt,.zip,.docx,.xlsx"
          />
          <button type="submit" class="btn primary">发送</button>
        </form>
      </section>
    </main>
  );
}
