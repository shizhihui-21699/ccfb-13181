import { define } from "../../../../utils.ts";
import * as repo from "../../../../lib/repo.ts";
import { can, staffOrRedirect } from "../../../../lib/auth.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const auth = staffOrRedirect(ctx);
    if (auth instanceof Response) return auth;
    const staff = auth;

    if (!can(staff, "assign_case")) {
      return new Response("无权分派", { status: 403 });
    }

    const caseRow = repo.getCaseById(ctx.params.id);
    if (!caseRow) return new Response("未找到", { status: 404 });

    let assignee = "";
    try {
      const form = await ctx.req.formData();
      assignee = String(form.get("assignee") ?? "");
    } catch {
      return ctx.redirect(
        `/staff/cases/${caseRow.id}?err=${
          encodeURIComponent("内容无法解析。")
        }`,
      );
    }

    if (assignee) {
      const target = repo.getStaffById(assignee);
      if (
        !target || !target.active ||
        !["investigator", "lead"].includes(target.role)
      ) {
        return ctx.redirect(
          `/staff/cases/${caseRow.id}?err=${
            encodeURIComponent("无效的调查员。")
          }`,
        );
      }
    }

    repo.assignCase(caseRow.id, assignee || null, staff.id);
    repo.audit(
      staff.id,
      assignee ? "case.assign" : "case.unassign",
      caseRow.case_number,
      assignee || null,
    );

    return ctx.redirect(
      `/staff/cases/${caseRow.id}?ok=${encodeURIComponent("分派已更新。")}`,
    );
  },
});
