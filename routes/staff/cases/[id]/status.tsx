import { define } from "../../../../utils.ts";
import * as repo from "../../../../lib/repo.ts";
import { canAccessCase, staffOrRedirect } from "../../../../lib/auth.ts";
import { STATUSES } from "../../../../lib/config.ts";

const VALID = new Set<string>(STATUSES.map((s) => s.value));

export const handler = define.handlers({
  async POST(ctx) {
    const auth = staffOrRedirect(ctx);
    if (auth instanceof Response) return auth;
    const staff = auth;

    const caseRow = repo.getCaseById(ctx.params.id);
    if (!caseRow) return new Response("未找到", { status: 404 });
    if (!canAccessCase(staff, caseRow, "change_status")) {
      return new Response("无权操作", { status: 403 });
    }
    if (caseRow.status === "withdrawn") {
      return ctx.redirect(
        `/staff/cases/${caseRow.id}?err=${
          encodeURIComponent("举报人已撤回，不能变更状态。")
        }`,
      );
    }

    let status = "";
    try {
      const form = await ctx.req.formData();
      status = String(form.get("status") ?? "");
    } catch {
      return ctx.redirect(
        `/staff/cases/${caseRow.id}?err=${
          encodeURIComponent("内容无法解析。")
        }`,
      );
    }

    if (!VALID.has(status)) {
      return ctx.redirect(
        `/staff/cases/${caseRow.id}?err=${encodeURIComponent("无效状态。")}`,
      );
    }

    repo.setCaseStatus(caseRow.id, status as repo.CaseStatus, staff.id);
    repo.audit(staff.id, "case.status", caseRow.case_number, status);

    return ctx.redirect(
      `/staff/cases/${caseRow.id}?ok=${encodeURIComponent("状态已更新。")}`,
    );
  },
});
