import { Handlers, PageProps } from "$fresh/server.ts";
import { createReporterSession, getCase, rateLimit } from "../../lib/db.ts";
import { normalizeCredential, verifySecret } from "../../lib/crypto.ts";
import { redirect, sessionCookie } from "../../lib/session.ts";

interface Data {
  error?: string;
}

export const handler: Handlers<Data> = {
  GET(_req, ctx) {
    return ctx.render({});
  },

  async POST(req, ctx) {
    const form = await req.formData();
    const number = normalizeCredential(String(form.get("number") ?? ""));
    const secret = normalizeCredential(String(form.get("secret") ?? ""));

    // 按案件编号限流,防止口令暴力破解
    if (!(await rateLimit(`caselogin:${number}`, 10, 10 * 60 * 1000))) {
      return ctx.render({ error: "尝试次数过多,请 10 分钟后再试" }, {
        status: 429,
      });
    }

    const caseItem = await getCase(number);
    // 编号不存在与口令错误返回同样的提示,避免暴露编号是否存在
    if (
      !caseItem ||
      !(await verifySecret(secret, caseItem.secretSalt, caseItem.secretHash))
    ) {
      return ctx.render({ error: "案件编号或口令不正确" }, { status: 403 });
    }

    const token = await createReporterSession(caseItem.number);
    const headers = new Headers();
    headers.append(
      "set-cookie",
      sessionCookie("reporter_session", token, 2 * 60 * 60),
    );
    return redirect(`/case/${encodeURIComponent(caseItem.number)}`, headers);
  },
};

export default function CaseLookup({ data }: PageProps<Data>) {
  return (
    <main class="page narrow">
      <h1>查询案件进展</h1>
      <p class="muted">输入提交举报时获得的案件编号和查询口令。</p>
      {data.error && <div class="error-box">{data.error}</div>}
      <form method="post" class="form">
        <label>
          案件编号
          <input
            type="text"
            name="number"
            required
            placeholder="如 K7Q3-9M2X"
            autocomplete="off"
          />
        </label>
        <label>
          查询口令
          <input
            type="text"
            name="secret"
            required
            placeholder="如 4F2K-Q8MN-3RXT"
            autocomplete="off"
          />
        </label>
        <button type="submit" class="btn primary">查询</button>
      </form>
      <p class="muted small">
        凭据丢失无法找回 ——
        这是匿名性的代价:平台不保存任何能证明"你是你"的信息。
      </p>
    </main>
  );
}
