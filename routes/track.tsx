import { define } from "../utils.ts";
import { Field, Notice, PageHeader } from "../components/ui.tsx";
import { signInReporter, withCookies } from "../lib/auth.ts";

export const handler = define.handlers({
  GET(ctx) {
    if (ctx.state.reporter) return ctx.redirect("/case");
    return {
      data: {
        error: ctx.url.searchParams.get("expired")
          ? "链接已过期或已使用，请输入凭据。"
          : "",
      },
    };
  },

  async POST(ctx) {
    let credential = "";
    try {
      const form = await ctx.req.formData();
      credential = String(form.get("credential") ?? "");
    } catch {
      return { data: { error: "提交内容无法解析。" }, status: 400 };
    }

    const session = signInReporter(credential);
    if (!session) {
      // 统一的失败信息：不区分"格式错误"与"凭据不存在"，避免枚举。
      return {
        data: {
          error:
            "凭据无效。请检查是否输错字符（I/L 可写作 1，O 可写作 0）。凭据丢失无法找回。",
        },
        status: 401,
      };
    }

    return withCookies(ctx.redirect("/case"), [session.cookie]);
  },
});

export default define.page<typeof handler>(function TrackPage({ data }) {
  return (
    <>
      <PageHeader
        title="查询进展"
        subtitle="输入你提交时拿到的案件凭据。不需要登录，也不需要提供任何身份信息。"
      />

      {data.error && (
        <Notice kind="danger" title="无法查询">{data.error}</Notice>
      )}

      <form class="card" method="post" action="/track">
        <Field
          label="案件凭据"
          required
          hint="25 位字母数字，可以带分隔符。大小写不敏感。"
        >
          <input
            type="text"
            name="credential"
            autocomplete="off"
            autocapitalize="characters"
            spellcheck={false}
            required
            placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
            class="mono"
            style="letter-spacing:0.06em"
          />
        </Field>
        <div class="btn-row">
          <button class="btn" type="submit">查看案件</button>
        </div>
      </form>

      <Notice kind="info" title="凭据安全提示">
        <ul>
          <li>本页面不会记住你输入的内容，也不会把它写进 URL。</li>
          <li>如果你在公共电脑上操作，用完请点「退出」并清除历史。</li>
          <li>连续输错不会锁定，但凭据本身有 125 位随机熵，无法被猜中。</li>
        </ul>
      </Notice>

      <p class="muted small">
        忘记凭据了？系统没有你的身份信息，因此无法重置或找回。你仍然可以用新的凭据重新提交一份举报，并在正文中说明「此前已提交过，编号为
        WM-…」。
      </p>
    </>
  );
});
