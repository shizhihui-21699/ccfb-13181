import { define } from "../../utils.ts";
import { signOutReporter, withCookies } from "../../lib/auth.ts";

export const handler = define.handlers({
  POST(ctx) {
    return withCookies(ctx.redirect("/track"), [signOutReporter(ctx.req)]);
  },
  GET(ctx) {
    return withCookies(ctx.redirect("/track"), [signOutReporter(ctx.req)]);
  },
});
