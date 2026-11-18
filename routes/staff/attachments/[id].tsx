import { define } from "../../../utils.ts";
import * as repo from "../../../lib/repo.ts";
import { canAccessCase, staffOrRedirect } from "../../../lib/auth.ts";
import { readFileSync } from "node:fs";
import { join } from "jsr:@std/path@^1.1.2";
import { config } from "../../../lib/config.ts";
import { decryptBlob, sha256Hex } from "../../../lib/crypto.ts";

export const handler = define.handlers({
  GET(ctx) {
    const auth = staffOrRedirect(ctx);
    if (auth instanceof Response) return auth;
    const staff = auth;

    const att = repo.getAttachment(ctx.params.id);
    if (!att) return new Response("未找到", { status: 404 });

    const caseRow = repo.getCaseById(att.case_id);
    if (!caseRow || !canAccessCase(staff, caseRow, "download_attachment")) {
      // 无权访问与不存在返回一致，避免探测附件 ID。
      return new Response("未找到", { status: 404 });
    }

    try {
      const raw = readFileSync(join(config.attachmentDir, att.stored_name));
      const bytes = decryptBlob(new Uint8Array(raw));
      if (sha256Hex(bytes) !== att.sha256) {
        return new Response("附件校验失败", { status: 500 });
      }

      // 下载附件是敏感动作，必须留痕（谁、何时、哪个案件）。
      repo.audit(
        staff.id,
        "attachment.download",
        caseRow.case_number,
        att.id,
      );

      const ext = att.stored_name.split(".").pop() ?? "bin";
      return new Response(bytes as unknown as BodyInit, {
        headers: {
          "content-type": att.content_type,
          "content-length": String(bytes.length),
          "content-disposition":
            `inline; filename="${caseRow.case_number}-${att.id}.${ext}"`,
          "x-content-type-options": "nosniff",
          "content-security-policy":
            "sandbox; default-src 'none'; img-src 'self' data:",
          "cache-control": "no-store",
        },
      });
    } catch (err) {
      console.error("staff attachment read failed", err);
      return new Response("附件不可用", { status: 500 });
    }
  },
});
