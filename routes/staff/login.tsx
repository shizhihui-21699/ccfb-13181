import { Handlers, PageProps } from "$fresh/server.ts";
import { createStaffSession, getStaffUser, rateLimit } from "../../lib/db.ts";
import { verifySecret } from "../../lib/crypto.ts";
import { getCookies, redirect, sessionCookie } from "../../lib/session.ts";

interface Data {
  error?: string;
}

export const handler: Handlers<Data> = {
  GET(req, ctx) {
    if (getCookies(req)["staff_session"]) return redirect("/staff");
    return ctx.render({});
  },

  async POST(req, ctx) {
    const form = await req.formData();
    const username = String(form.get("username") ?? "").trim();
    const password = String(form.get("password") ?? "");

    if (!(await rateLimit(`stafflogin:${username}`, 10, 10 * 60 * 1000))) {
      return ctx.render({ error: "尝试次数过多,请 10 分钟后再试" }, {
        status: 429,
      });
    }

    const user = await getStaffUser(username);
    if (!user || !(await verifySecret(password, user.salt, user.passHash))) {
      return ctx.render({ error: "用户名或密码错误" }, { status: 403 });
    }

    const token = await createStaffSession(user.username);
    const headers = new Headers();
    headers.append(
      "set-cookie",
      sessionCookie("staff_session", token, 12 * 60 * 60),
    );
    return redirect("/staff", headers);
  },
};

export default function StaffLogin({ data }: PageProps<Data>) {
  return (
    <main class="page narrow">
      <h1>工作人员登录</h1>
      {data.error && <div class="error-box">{data.error}</div>}
      <form method="post" class="form">
        <label>
          用户名
          <input type="text" name="username" required autocomplete="username" />
        </label>
        <label>
          密码
          <input
            type="password"
            name="password"
            required
            autocomplete="current-password"
          />
        </label>
        <button type="submit" class="btn primary">登录</button>
      </form>
    </main>
  );
}
