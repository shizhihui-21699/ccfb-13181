import { Handlers } from "$fresh/server.ts";
import { deleteStaffSession } from "../../lib/db.ts";
import { clearCookie, getCookies, redirect } from "../../lib/session.ts";

export const handler: Handlers = {
  async GET(req) {
    const token = getCookies(req)["staff_session"];
    if (token) await deleteStaffSession(token);
    const headers = new Headers();
    headers.append("set-cookie", clearCookie("staff_session"));
    return redirect("/", headers);
  },
};
