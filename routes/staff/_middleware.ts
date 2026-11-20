import { FreshContext } from "$fresh/server.ts";
import { getStaffBySession } from "../../lib/db.ts";
import { getCookies, redirect } from "../../lib/session.ts";

export async function handler(req: Request, ctx: FreshContext) {
  const url = new URL(req.url);
  if (url.pathname === "/staff/login") return await ctx.next();

  const token = getCookies(req)["staff_session"];
  const user = token ? await getStaffBySession(token) : null;
  if (!user) return redirect("/staff/login");
  ctx.state.user = user;
  return await ctx.next();
}
