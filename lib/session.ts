export function getCookies(req: Request): Record<string, string> {
  const header = req.headers.get("cookie") ?? "";
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

function cookieSecure(): boolean {
  // 生产环境(HTTPS)必须为 true;本地开发可设 COOKIE_SECURE=0
  return Deno.env.get("COOKIE_SECURE") !== "0";
}

export function sessionCookie(
  name: string,
  value: string,
  maxAgeSec: number,
): string {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}` +
    (cookieSecure() ? "; Secure" : "");
}

export function clearCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function redirect(location: string, headers?: Headers): Response {
  const h = headers ?? new Headers();
  h.set("location", location);
  return new Response(null, { status: 303, headers: h });
}
