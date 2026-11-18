import { define } from "../../../utils.ts";
import * as repo from "../../../lib/repo.ts";
import { readFileSync } from "node:fs";
import { join } from "jsr:@std/path@^1.1.2";
import { config } from "../../../lib/config.ts";
import { decryptBlob, sha256Hex } from "../../../lib/crypto.ts";

/** 举报人下载自己案件的附件。只能访问自己案件的。 */
export const handler = define.handlers({
  GET(ctx) {
    const c = ctx.state.reporter;
    if (!c) return ctx.redirect("/track");

    const att = repo.getAttachment(ctx.params.id);
    if (!att || att.case_id !== c.id || att.direction !== "reporter") {
      return new Response("未找到", { status: 404 });
    }

    try {
      const raw = readFileSync(join(config.attachmentDir, att.stored_name));
      const bytes = decryptBlob(new Uint8Array(raw));
      // 完整性自检：库被篡改时宁可拒绝，也不要把坏材料给举报人。
      if (sha256Hex(bytes) !== att.sha256) {
        return new Response("附件校验失败", { status: 500 });
      }
      return new Response(bytes as unknown as BodyInit, {
        headers: {
          "content-type": att.content_type,
          "content-length": String(bytes.length),
          "content-disposition": `inline; filename="attachment.${
            att.stored_name.split(".").pop()
          }"`,
          "x-content-type-options": "nosniff",
          // 直接展示的文件一律 sandbox，PDF 也不例外（防止内嵌脚本）。
          "content-security-policy":
            "sandbox; default-src 'none'; img-src 'self' data:",
        },
      });
    } catch (err) {
      console.error("attachment read failed", err);
      return new Response("附件不可用", { status: 500 });
    }
  },
});
