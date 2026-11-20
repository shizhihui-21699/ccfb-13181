import { FreshContext } from "$fresh/server.ts";

export async function handler(req: Request, ctx: FreshContext) {
  // 同源校验:跨站 POST 直接拒绝(配合 SameSite=Lax Cookie 防 CSRF)
  if (req.method === "POST") {
    const origin = req.headers.get("origin");
    if (origin && new URL(origin).host !== new URL(req.url).host) {
      return new Response("Forbidden", { status: 403 });
    }
  }
  const res = await ctx.next();
  const h = res.headers;
  // 不缓存任何页面:避免案件内容留在浏览器缓存里
  h.set("cache-control", "no-store");
  // 锁定资源来源:不加载任何第三方脚本/字体/统计
  h.set(
    "content-security-policy",
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
      "script-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  );
  h.set("referrer-policy", "no-referrer");
  h.set("x-content-type-options", "nosniff");
  h.set("x-frame-options", "DENY");
  h.set("cross-origin-opener-policy", "same-origin");
  h.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  return res;
}
