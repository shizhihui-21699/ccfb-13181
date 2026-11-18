import { define } from "../../../../utils.ts";
import * as repo from "../../../../lib/repo.ts";
import { canAccessCase, staffOrRedirect } from "../../../../lib/auth.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const auth = staffOrRedirect(ctx);
    if (auth instanceof Response) return auth;
    const staff = auth;

    const caseRow = repo.getCaseById(ctx.params.id);
    if (!caseRow) return new Response("未找到", { status: 404 });
    if (!canAccessCase(staff, caseRow, "message_reporter")) {
      return new Response("无权操作", { status: 403 });
    }
    if (["closed", "withdrawn"].includes(caseRow.status)) {
      return ctx.redirect(
        `/staff/cases/${caseRow.id}?err=${
          encodeURIComponent("案件已关闭，不能继续留言。")
        }`,
      );
    }

    let body = "";
    let visibility = "reporter";
    try {
      const form = await ctx.req.formData();
      body = String(form.get("body") ?? "").trim();
      visibility = String(form.get("visibility") ?? "reporter");
    } catch {
      return ctx.redirect(
        `/staff/cases/${caseRow.id}?err=${
          encodeURIComponent("内容无法解析。")
        }`,
      );
    }

    if (!body) {
      return ctx.redirect(
        `/staff/cases/${caseRow.id}?err=${
          encodeURIComponent("消息不能为空。")
        }`,
      );
    }
    if (body.length > 10000) {
      return ctx.redirect(
        `/staff/cases/${caseRow.id}?err=${
          encodeURIComponent("消息超过 10000 字。")
        }`,
      );
    }

    const internal = visibility === "internal";
    repo.addStaffMessage({
      caseId: caseRow.id,
      staffId: staff.id,
      body,
      internalOnly: internal,
    });

    if (!internal) {
      // 发给举报人时，把案件置为"等待你补充"，让举报人一眼看到需要回应。
      if (!["closed", "withdrawn", "resolved"].includes(caseRow.status)) {
        repo.setCaseStatus(caseRow.id, "awaiting_reporter", staff.id);
      }
    }

    repo.audit(
      staff.id,
      internal ? "case.internal_note" : "case.message_reporter",
      caseRow.case_number,
    );

    return ctx.redirect(
      `/staff/cases/${caseRow.id}?ok=${
        encodeURIComponent(internal ? "内部备注已保存。" : "已发送给举报人。")
      }`,
    );
  },
});
