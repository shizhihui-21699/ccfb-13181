import { define } from "../utils.ts";
import { CATEGORIES, config, SEVERITIES } from "../lib/config.ts";
import { Field, Notice, PageHeader } from "../components/ui.tsx";
import { parseForm } from "../lib/forms.ts";
import { ValidationError } from "../lib/service.ts";

interface Draft {
  category: string;
  severity: string;
  subject: string;
  body: string;
  error?: string;
}

function FormPage({ data }: { data: Draft }) {
  return (
    <>
      <PageHeader
        title="提交举报"
        subtitle="请只写事实：发生了什么、涉及谁或哪个部门、大致时间、你掌握的证据。不需要写你自己的信息。"
      />

      {data.error && (
        <Notice kind="danger" title="提交未成功">
          {data.error}
        </Notice>
      )}

      <form
        class="card"
        method="post"
        action="/report"
        enctype="multipart/form-data"
      >
        <Field label="举报类别" required>
          <select name="category" required>
            <option value="">请选择…</option>
            {CATEGORIES.map((c) => (
              <option value={c.value} selected={data.category === c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="严重程度"
          hint="这只影响内部处理优先级，不影响你的匿名性。"
        >
          <div class="radio-row">
            {SEVERITIES.map((s) => (
              <label>
                <input
                  type="radio"
                  name="severity"
                  value={s.value}
                  checked={(data.severity || "medium") === s.value}
                />
                <span>{s.label}</span>
              </label>
            ))}
          </div>
        </Field>

        <Field
          label="一句话概括"
          required
          hint="例如：「采购部某项目供应商疑似围标」。请不要写你的姓名或联系方式。"
        >
          <input
            type="text"
            name="subject"
            maxlength={200}
            required
            value={data.subject}
            placeholder="用一句话说明问题"
          />
        </Field>

        <Field
          label="详细说明"
          required
          hint="至少 20 字。包含：发生了什么、涉及谁或哪个部门、大致时间地点、是否有其他人知情、你希望调查组采取什么行动。"
        >
          <textarea
            name="body"
            required
            maxlength={config.maxBodyChars}
            placeholder="请描述具体情况…"
          >
            {data.body}
          </textarea>
        </Field>

        <Field
          label="附件（可选）"
          hint={`最多 ${config.maxAttachments} 个，单个不超过 ${
            Math.round(config.maxAttachmentBytes / 1048576)
          } MB。支持 PNG / JPEG / WebP 图片、PDF、纯文本。`}
        >
          <input
            type="file"
            name="attachment"
            multiple
            accept=".png,.jpg,.jpeg,.webp,.pdf,.txt,image/png,image/jpeg,image/webp,application/pdf,text/plain"
          />
        </Field>

        <Notice kind="info" title="上传前会自动处理附件">
          <ul>
            <li>清除照片的拍摄地点、设备型号、拍摄时间等元数据。</li>
            <li>清除 PDF/Word 转出的作者、公司、编辑记录。</li>
            <li>文件名会被替换成随机名，原始文件名不会保存。</li>
            <li>
              但画面本身仍可能暴露你（工牌、桌上的文件、窗外景物、屏幕反光）。上传前请自行检查。
            </li>
            <li>
              Office
              文档（.docx/.xlsx/.pptx）携带的作者信息无法可靠清除，请先另存为
              PDF。
            </li>
          </ul>
        </Notice>

        <div class="btn-row">
          <button class="btn" type="submit">提交举报</button>
          <a class="btn ghost" href="/">取消</a>
        </div>
      </form>

      <Notice kind="warn" title="提交前最后确认">
        不需要填写姓名、工号、邮箱或电话。若你写了，这些文字会随举报内容一起被调查组看到，
        但系统不会因此知道你是谁。请自行判断是否要在正文里留下可识别信息。
      </Notice>
    </>
  );
}

export const handler = define.handlers({
  GET() {
    return {
      data: {
        category: "",
        severity: "medium",
        subject: "",
        body: "",
      } satisfies Draft,
    };
  },

  async POST(ctx) {
    const allowed = CATEGORIES.map((c) => c.value);
    let fields: Record<string, string> = {};
    let files = [];

    try {
      const parsed = await parseForm(
        ctx.req,
        config.maxTotalUploadBytes + 65536,
      );
      fields = parsed.fields;
      files = parsed.files;
    } catch (err) {
      return {
        data: {
          category: "",
          severity: "medium",
          subject: "",
          body: "",
          error: err instanceof Error ? err.message : "提交内容无法解析。",
        } satisfies Draft,
        status: 413,
      };
    }

    const draft: Draft = {
      category: fields.category ?? "",
      severity: fields.severity ?? "medium",
      subject: fields.subject ?? "",
      body: fields.body ?? "",
    };

    try {
      const { submitReport } = await import("../lib/service.ts");
      const result = await submitReport(
        {
          category: draft.category,
          severity: draft.severity,
          subject: draft.subject,
          body: draft.body,
          uploads: files,
        },
        allowed,
      );

      // 结果页必须能"只显示一次"。用 URL 承载凭据会在浏览器历史/服务器日志里留下痕迹，
      // 因此改为服务端一次性的短时凭据交付。
      const { stashCredentialDelivery } = await import("../lib/delivery.ts");
      const token = stashCredentialDelivery(result);
      return ctx.redirect(`/report/done?t=${token}`);
    } catch (err) {
      if (err instanceof ValidationError) {
        return {
          data: { ...draft, error: err.message } satisfies Draft,
          status: 400,
        };
      }
      console.error("submit failed", err);
      return {
        data: {
          ...draft,
          error:
            "服务器暂时无法处理提交，请稍后重试。若反复失败，请联系合规部其他渠道。",
        } satisfies Draft,
        status: 500,
      };
    }
  },
});

export default define.page<typeof handler>(function ReportPage({ data }) {
  return <FormPage data={data as Draft} />;
});
