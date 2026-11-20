import { Handlers, PageProps } from "$fresh/server.ts";
import {
  addMessage,
  CaseMessage,
  getCase,
  getReporterSessionCase,
  listMessages,
  rateLimit,
  saveFile,
  STATUS_LABELS,
  WhistleCase,
} from "../../lib/db.ts";
import {
  ALLOWED_FILE_TYPES,
  MAX_FILE_SIZE,
  sanitizeUpload,
} from "../../lib/sanitize.ts";
import { getCookies, redirect } from "../../lib/session.ts";

interface Data {
  caseItem: WhistleCase;
  messages: CaseMessage[];
  error?: string;
}

async function authorized(req: Request, caseNumber: string): Promise<boolean> {
  const token = getCookies(req)["reporter_session"];
  if (!token) return false;
  return (await getReporterSessionCase(token)) === caseNumber;
}

export const handler: Handlers<Data> = {
  async GET(req, ctx) {
    const number = ctx.params.id.toUpperCase();
    if (!(await authorized(req, number))) return redirect("/case");
    const caseItem = await getCase(number);
    if (!caseItem) return redirect("/case");
    const messages = await listMessages(number);
    return ctx.render({ caseItem, messages });
  },

  async POST(req, ctx) {
    const number = ctx.params.id.toUpperCase();
    if (!(await authorized(req, number))) return redirect("/case");
    const caseItem = await getCase(number);
    if (!caseItem) return redirect("/case");

    if (!(await rateLimit(`msg:${number}`, 30, 60 * 60 * 1000))) {
      const messages = await listMessages(number);
      return ctx.render({
        caseItem,
        messages,
        error: "发送过于频繁,请稍后再试",
      }, { status: 429 });
    }

    const form = await req.formData();
    const body = String(form.get("body") ?? "").trim();
    const file = form.get("file");

    const files: { id: string; name: string; size: number }[] = [];
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_FILE_SIZE || !ALLOWED_FILE_TYPES[file.type]) {
        const messages = await listMessages(number);
        return ctx.render({
          caseItem,
          messages,
          error: "附件类型不支持或超过 5MB",
        }, { status: 400 });
      }
      const sanitized = sanitizeUpload(
        file.type,
        new Uint8Array(await file.arrayBuffer()),
      );
      if (!sanitized) {
        const messages = await listMessages(number);
        return ctx.render({
          caseItem,
          messages,
          error: "图片文件损坏或格式异常",
        }, { status: 400 });
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
      const messages = await listMessages(number);
      return ctx.render({ caseItem, messages, error: "请填写内容或选择附件" }, {
        status: 400,
      });
    }

    await addMessage({ caseNumber: number, from: "reporter", body, files });
    return redirect(`/case/${encodeURIComponent(number)}`);
  },
};

export default function CasePage({ data }: PageProps<Data>) {
  const { caseItem, messages } = data;
  const closed = caseItem.status === "closed";
  return (
    <main class="page">
      <header class="case-header">
        <h1>{caseItem.title}</h1>
        <p class="muted">
          案件编号 <code>{caseItem.number}</code> · 提交于 {caseItem.day} ·{" "}
          <span class={`status status-${caseItem.status}`}>
            {STATUS_LABELS[caseItem.status]}
          </span>
        </p>
      </header>

      <section class="card">
        <h2>举报内容</h2>
        <p class="pre-wrap">{caseItem.description}</p>
      </section>

      <section class="thread">
        <h2>沟通记录</h2>
        {messages.length === 0 && (
          <p class="muted">暂无消息。调查人员受理后会在此与你联系。</p>
        )}
        {messages.map((m) => (
          <article class={`msg ${m.from}`}>
            <header>
              {/* 对举报人,工作人员一律显示为"调查人员",不暴露其姓名 */}
              <strong>{m.from === "reporter" ? "我" : "调查人员"}</strong>
              <time>{m.at}</time>
            </header>
            {m.body && <p class="pre-wrap">{m.body}</p>}
            {m.files.map((f) => (
              <p>
                <a href={`/files/${f.id}`}>📎 {f.name}</a>{" "}
                <span class="muted small">({Math.ceil(f.size / 1024)} KB)</span>
              </p>
            ))}
          </article>
        ))}
      </section>

      {!closed && (
        <section class="card">
          <h2>补充材料 / 回复</h2>
          {data.error && <div class="error-box">{data.error}</div>}
          <form method="post" enctype="multipart/form-data" class="form">
            <textarea
              name="body"
              rows={4}
              maxLength={5000}
              placeholder="补充说明或回复调查人员的问题……"
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
      )}
      {closed && <p class="muted">本案已结案,沟通通道已关闭。</p>}
    </main>
  );
}
