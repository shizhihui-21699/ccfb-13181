import { define } from "../../utils.ts";
import { config } from "../../lib/config.ts";
import { parseForm } from "../../lib/forms.ts";
import { ValidationError } from "../../lib/service.ts";
import * as repo from "../../lib/repo.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const c = ctx.state.reporter;
    if (!c) return ctx.redirect("/track");
    if (["closed", "resolved", "withdrawn"].includes(c.status)) {
      return ctx.redirect("/case");
    }

    let body = "";
    let files: Awaited<ReturnType<typeof parseForm>>["files"] = [];
    try {
      const parsed = await parseForm(
        ctx.req,
        config.maxTotalUploadBytes + 65536,
      );
      body = parsed.fields.body ?? "";
      files = parsed.files;
    } catch (err) {
      console.error("reply parse failed", err);
      return ctx.redirect("/case?error=parse");
    }

    try {
      const { reporterReply } = await import("../../lib/service.ts");
      await reporterReply(c.id, body, files);
      // 若案件正处于"等待举报人补充"，回复后自动回到调查中，
      // 让调查员在队列里立刻看到"材料已到"。
      repo.reopenByReporter(c.id);
    } catch (err) {
      if (err instanceof ValidationError) {
        return ctx.redirect("/case?error=" + encodeURIComponent(err.message));
      }
      console.error("reply failed", err);
      return ctx.redirect("/case?error=send");
    }

    return ctx.redirect("/case?sent=1");
  },
});
