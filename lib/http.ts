// HTTP 层安全基线。
//
// 关键点：默认"不记录"。
// - 不写访问日志（Fresh 默认也不写 IP，但我们连 UA/路径都不落盘）
// - 响应头收紧：CSP、禁止被第三方嵌入、禁止 Referer 外泄
// - Referrer-Policy 设为 no-referrer：即便举报人从内网系统点进来，
//   我们也绝不把来源页面传给任何外部资源（本应用不加载外部资源）

import type { Middleware } from "fresh";
import type { State } from "../utils.ts";
import { config } from "./config.ts";

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'", // Fresh 内联 runtime 需要
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export const securityHeaders: Middleware<State> = async (ctx) => {
  const res = await ctx.next();
  const h = res.headers;

  h.set("Content-Security-Policy", CSP);
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "no-referrer");
  h.set("Cross-Origin-Opener-Policy", "same-origin");
  h.set("Cross-Origin-Resource-Policy", "same-origin");
  h.set("Permissions-Policy", "geolocation=(), camera=(), microphone=()");
  h.set("X-Frame-Options", "DENY");
  if (config.secure) {
    h.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  // 匿名举报页绝不能被缓存：共享电脑上的"后退"会暴露案件内容。
  if (!ctx.url.pathname.startsWith("/staff")) {
    h.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    h.set("Pragma", "no-cache");
  } else {
    h.set("Cache-Control", "no-store");
  }

  return res;
};

/**
 * 只保留必要的方法。任何 OPTIONS/TRACE 一律不响应细节。
 */
export const methodGuard: Middleware<State> = (ctx) => {
  if (ctx.req.method === "TRACE") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  return ctx.next();
};
