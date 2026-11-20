import { Handlers } from "$fresh/server.ts";
import {
  getFileMeta,
  getReporterSessionCase,
  getStaffBySession,
  readFileData,
} from "../../lib/db.ts";
import { getCookies } from "../../lib/session.ts";

export const handler: Handlers = {
  async GET(req, ctx) {
    const meta = await getFileMeta(ctx.params.id);
    if (!meta) return new Response("Not found", { status: 404 });

    // 授权:任一工作人员会话,或与文件所属案件匹配的举报人会话。
    // 未授权一律 404,不暴露文件是否存在。
    const cookies = getCookies(req);
    let ok = false;
    if (
      cookies["staff_session"] &&
      (await getStaffBySession(cookies["staff_session"]))
    ) {
      ok = true;
    } else if (cookies["reporter_session"]) {
      ok = (await getReporterSessionCase(cookies["reporter_session"])) ===
        meta.caseNumber;
    }
    if (!ok) return new Response("Not found", { status: 404 });

    const data = await readFileData(meta);
    return new Response(data as unknown as BodyInit, {
      headers: {
        "content-type": meta.type,
        "content-disposition": `attachment; filename*=UTF-8''${
          encodeURIComponent(meta.name)
        }`,
        "x-content-type-options": "nosniff",
        "content-security-policy": "sandbox",
      },
    });
  },
};
