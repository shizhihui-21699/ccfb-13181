import { define } from "../../../utils.ts";
import * as repo from "../../../lib/repo.ts";
import { can, staffOrRedirect } from "../../../lib/auth.ts";
import { audit } from "../../../lib/repo.ts";

/** CSV 注入防护：以 = + - @ 开头的单元格前置单引号。 */
function cell(v: string | null): string {
  if (v === null) return "";
  const s = String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export const handler = define.handlers({
  GET(ctx) {
    const auth = staffOrRedirect(ctx);
    if (auth instanceof Response) return auth;
    if (!can(auth, "export_audit")) {
      return new Response("无权访问", { status: 403 });
    }

    const rows = repo.listAudit(10000);
    const lines = [
      ["时间", "操作人", "动作", "对象", "详情"].map(cell).join(","),
      ...rows.map((r) =>
        [
          r.created_at,
          r.actor_name,
          r.action,
          r.target,
          r.detail,
        ].map(cell).join(",")
      ),
    ];

    audit(auth.id, "audit.export", `rows=${rows.length}`);

    // 加 BOM，Excel 打开中文不乱码。
    const body = "﻿" + lines.join("\r\n");
    return new Response(body, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="audit-${
          new Date().toISOString().slice(0, 10)
        }.csv"`,
        "cache-control": "no-store",
      },
    });
  },
});
