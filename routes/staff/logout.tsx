import { define } from "../../utils.ts";
import { logoutStaff, withCookies } from "../../lib/auth.ts";

export const handler = define.handlers({
  POST(ctx) {
    return withCookies(ctx.redirect("/staff/login"), [logoutStaff(ctx.req)]);
  },
  GET(ctx) {
    return withCookies(ctx.redirect("/staff/login"), [logoutStaff(ctx.req)]);
  },
});
