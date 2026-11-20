import { Handlers, PageProps } from "$fresh/server.ts";
import ReportForm from "../islands/ReportForm.tsx";
import { addMessage, createCase, rateLimit, saveFile } from "../lib/db.ts";
import {
  ALLOWED_FILE_TYPES,
  detectContactInfo,
  MAX_FILE_SIZE,
  sanitizeUpload,
} from "../lib/sanitize.ts";

interface Data {
  step: "form" | "confirm" | "done" | "error";
  error?: string;
  warnings?: string[];
  initial?: { title?: string; category?: string; description?: string };
  caseNumber?: string;
  caseSecret?: string;
}

export const handler: Handlers<Data> = {
  GET(_req, ctx) {
    return ctx.render({ step: "form" });
  },

  async POST(req, ctx) {
    // 全局限流:不基于 IP(IP 是可定位信息,不记录),改用全局窗口
    if (!(await rateLimit("report", 20, 60 * 60 * 1000))) {
      return ctx.render({ step: "error", error: "提交过于频繁,请稍后再试" }, {
        status: 429,
      });
    }

    const form = await req.formData();
    const title = String(form.get("title") ?? "").trim();
    const category = String(form.get("category") ?? "").trim();
    const description = String(form.get("description") ?? "").trim();
    const confirmed = form.get("confirmed") === "1";

    if (
      !title || title.length > 80 || !category || !description ||
      description.length > 5000
    ) {
      return ctx.render({
        step: "error",
        error: "请完整填写标题、类别和描述(描述不超过 5000 字)",
      }, { status: 400 });
    }

    // 服务端二次检测联系方式;未确认则返回确认页(附件需重新选择)
    const warnings = detectContactInfo(title + "\n" + description);
    if (warnings.length > 0 && !confirmed) {
      return ctx.render({
        step: "confirm",
        warnings,
        initial: { title, category, description },
      });
    }

    // 附件:校验类型与大小,图片剥离元数据
    const file = form.get("file");
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_FILE_SIZE) {
        return ctx.render({ step: "error", error: "附件超过 5MB 上限" }, {
          status: 400,
        });
      }
      if (!ALLOWED_FILE_TYPES[file.type]) {
        return ctx.render({ step: "error", error: "不支持的文件类型" }, {
          status: 400,
        });
      }
      const sanitized = sanitizeUpload(
        file.type,
        new Uint8Array(await file.arrayBuffer()),
      );
      if (!sanitized) {
        return ctx.render({
          step: "error",
          error: "图片文件损坏或格式异常,请重新导出后上传",
        }, { status: 400 });
      }
      return await finish(ctx, { title, category, description }, {
        name: file.name,
        type: file.type,
        data: sanitized.data,
        metaStripped: sanitized.metaStripped,
      });
    }

    return await finish(ctx, { title, category, description }, null);
  },
};

async function finish(
  ctx: Parameters<NonNullable<Handlers<Data>["POST"]>>[1],
  input: { title: string; category: string; description: string },
  file:
    | { name: string; type: string; data: Uint8Array; metaStripped: boolean }
    | null,
) {
  const { caseItem, secret } = await createCase(input);
  if (file) {
    const meta = await saveFile({
      caseNumber: caseItem.number,
      name: file.name,
      type: file.type,
      data: file.data,
      metaStripped: file.metaStripped,
    });
    await addMessage({
      caseNumber: caseItem.number,
      from: "reporter",
      body: "(提交举报时附带的材料)",
      files: [{ id: meta.id, name: meta.name, size: meta.size }],
    });
  }
  return ctx.render({
    step: "done",
    caseNumber: caseItem.number,
    caseSecret: secret,
  });
}

export default function ReportPage({ data }: PageProps<Data>) {
  if (data.step === "done") {
    return (
      <main class="page narrow">
        <h1>提交成功</h1>
        <div class="card credential-card">
          <p>
            以下是你唯一的案件凭据,<strong>只显示这一次</strong>,系统无法找回。
          </p>
          <p>请立即抄写、拍照或存入密码管理器:</p>
          <dl class="credential">
            <div>
              <dt>案件编号</dt>
              <dd>
                <code>{data.caseNumber}</code>
              </dd>
            </div>
            <div>
              <dt>查询口令</dt>
              <dd>
                <code>{data.caseSecret}</code>
              </dd>
            </div>
          </dl>
          <p class="muted small">
            凭这两项信息,你可以在"查询案件进展"页面查看处理进度、与调查人员匿名沟通。
            平台不存储任何能找回凭据的信息,丢失即无法恢复。
          </p>
        </div>
        <nav class="actions">
          <a class="btn primary" href="/case">前往查询案件</a>
          <a class="btn" href="/">返回首页</a>
        </nav>
      </main>
    );
  }

  return (
    <main class="page narrow">
      <h1>提交举报</h1>
      <p class="muted">
        本表单不记录
        IP、浏览器信息,也不需要任何账号。提交后你将获得一个案件凭据,用于后续查询进展。
      </p>
      {data.step === "error" && <div class="error-box">{data.error}</div>}
      {data.step === "confirm" && (
        <div class="warn-box">
          ⚠️ 你的内容中包含可能暴露身份的信息:{data.warnings!.join("、")}。
          建议返回修改;如确认无碍,请直接再次提交(附件需要重新选择)。
        </div>
      )}
      <ReportForm initial={data.initial} confirmed={data.step === "confirm"} />
    </main>
  );
}
