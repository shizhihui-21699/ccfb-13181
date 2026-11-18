// 认证与会话。
//
// 两条完全独立的认证路径，互不认识：
//   1. 举报人：从未提交过身份的凭据 → 案件。没有用户名，没有密码。
//   2. 员工：用户名 + 密码 + 会话 Cookie。这只在员工侧使用。
//
// 两条路径的 Cookie 名不同、有效期不同、作用域不同，且互相不引用。

import type { Middleware } from "fresh";
import type { State } from "../utils.ts";
import {
  hashCredential,
  hashSessionToken,
  randomToken,
  verifyPassword,
} from "./crypto.ts";
import * as repo from "./repo.ts";
import { config } from "./config.ts";
import { addDays, dayBucket } from "./time.ts";
import { normalizeCredential } from "./ids.ts";

export const REPORTER_COOKIE = "wsp_case";
export const STAFF_COOKIE = "wsp_staff";

/**
 * 举报人会话有效期：按"天"锚定，最少 24 小时、最多 48 小时。
 * 刻意不用精确到期时间——否则到期时刻可反推出举报人的登录时刻。
 */
function reporterSessionExpiry(): { expiresAt: string; maxAge: number } {
  return {
    expiresAt: `${addDays(dayBucket(), 2)}T00:00:00.000Z`,
    maxAge: 2 * 24 * 3600,
  };
}

/* ------------------------------------------------------------------ */
/* Cookie 工具                                                         */
/* ------------------------------------------------------------------ */

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function cookieHeader(
  name: string,
  value: string,
  opts: { maxAge?: number; path?: string } = {},
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${opts.path ?? "/"}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
  if (config.secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearCookieHeader(name: string, path = "/"): string {
  return cookieHeader(name, "", { maxAge: 0, path });
}

/** 把多条 Set-Cookie 附加到响应上。 */
export function withCookies(res: Response, cookies: string[]): Response {
  if (cookies.length === 0) return res;
  const headers = new Headers(res.headers);
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(res.body, { status: res.status, headers });
}

/* ------------------------------------------------------------------ */
/* 举报人会话                                                          */
/* ------------------------------------------------------------------ */

/**
 * 用凭据换取举报人会话。
 * 凭据校验失败时返回 null；调用方一律返回同一条错误信息，不区分"不存在"和"错误"。
 */
export function signInReporter(rawCredential: string): {
  caseRow: repo.CaseRow;
  cookie: string;
} | null {
  const normalized = normalizeCredential(rawCredential);
  if (!normalized) return null;

  const hash = hashCredential(normalized);
  const caseRow = repo.getCaseByCredentialHash(hash);
  if (!caseRow) return null;

  const token = randomToken();
  const expiry = reporterSessionExpiry();
  repo.purgeExpiredReporterSessions();
  repo.createReporterSession(
    hashSessionToken(token),
    caseRow.id,
    expiry.expiresAt,
  );

  return {
    caseRow,
    cookie: cookieHeader(REPORTER_COOKIE, token, { maxAge: expiry.maxAge }),
  };
}

/** 从请求中解析举报人会话对应的案件。 */
export function currentReporterCase(req: Request): {
  caseRow: repo.CaseRow;
  token: string;
} | null {
  const token = parseCookies(req.headers.get("cookie"))[REPORTER_COOKIE];
  if (!token) return null;
  const s = repo.getReporterSession(hashSessionToken(token));
  if (!s) return null;
  if (s.expires_at.slice(0, 10) < dayBucket()) {
    repo.deleteReporterSession(hashSessionToken(token));
    return null;
  }
  const caseRow = repo.getCaseById(s.case_id);
  if (!caseRow) return null;
  return { caseRow, token };
}

export function signOutReporter(req: Request): string {
  const token = parseCookies(req.headers.get("cookie"))[REPORTER_COOKIE];
  if (token) repo.deleteReporterSession(hashSessionToken(token));
  return clearCookieHeader(REPORTER_COOKIE);
}

/* ------------------------------------------------------------------ */
/* 员工登录                                                            */
/* ------------------------------------------------------------------ */

const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;

export type LoginResult =
  | { ok: true; cookie: string; staff: repo.StaffRow }
  | { ok: false; reason: "invalid" | "locked" | "disabled" };

export function loginStaff(username: string, password: string): LoginResult {
  const uname = username.trim();
  if (!uname || !password) return { ok: false, reason: "invalid" };

  const throttle = repo.getLoginThrottle(uname.toLowerCase());
  if (
    throttle.locked_until && throttle.locked_until > new Date().toISOString()
  ) {
    return { ok: false, reason: "locked" };
  }

  const staff = repo.getStaffByUsername(uname);
  // 用户不存在时也跑一次 scrypt，避免用响应时间枚举账号。
  const dummy =
    "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const ok = verifyPassword(password, staff?.password_hash ?? dummy);
  if (!staff || !ok) {
    const nextFailures = throttle.failures + 1;
    const lockUntil = nextFailures >= MAX_FAILURES
      ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString()
      : null;
    repo.recordLoginFailure(uname.toLowerCase(), lockUntil);
    repo.audit(staff?.id ?? null, "login_failed", uname.toLowerCase());
    return { ok: false, reason: "invalid" };
  }
  // 停用账号与密码错误返回一致的结果，避免用响应差异枚举账号。
  if (!staff.active) {
    repo.audit(staff.id, "login_disabled", staff.username);
    return { ok: false, reason: "invalid" };
  }

  repo.clearLoginFailures(uname.toLowerCase());
  repo.purgeExpiredStaffSessions();

  const token = randomToken();
  const expires = new Date(Date.now() + config.staffSessionHours * 3600_000)
    .toISOString();
  repo.createStaffSession(hashSessionToken(token), staff.id, expires);
  repo.setStaffLastLogin(staff.id);
  repo.audit(staff.id, "login", staff.username);

  return {
    ok: true,
    staff,
    cookie: cookieHeader(STAFF_COOKIE, token, {
      maxAge: config.staffSessionHours * 3600,
    }),
  };
}

export function logoutStaff(req: Request): string {
  const token = parseCookies(req.headers.get("cookie"))[STAFF_COOKIE];
  if (token) repo.deleteStaffSession(hashSessionToken(token));
  return clearCookieHeader(STAFF_COOKIE);
}

export function currentStaff(req: Request): repo.StaffRow | null {
  const token = parseCookies(req.headers.get("cookie"))[STAFF_COOKIE];
  if (!token) return null;
  const s = repo.getStaffSession(hashSessionToken(token));
  if (!s) return null;
  if (s.expires_at < new Date().toISOString()) {
    repo.deleteStaffSession(hashSessionToken(token));
    return null;
  }
  const staff = repo.getStaffById(s.staff_id);
  return staff?.active ? staff : null;
}

/* ------------------------------------------------------------------ */
/* 权限                                                                */
/* ------------------------------------------------------------------ */

export type Capability =
  | "view_case"
  | "assign_case"
  | "change_status"
  | "message_reporter"
  | "internal_note"
  | "download_attachment"
  | "manage_staff"
  | "view_audit"
  | "change_own_password"
  | "export_audit";

const MATRIX: Record<repo.StaffRole, Capability[]> = {
  // 调查员：只处理分派给自己的案件。
  investigator: [
    "view_case",
    "change_status",
    "message_reporter",
    "internal_note",
    "download_attachment",
    "change_own_password",
  ],
  // 合规负责人：全量案件、分派、结案。
  lead: [
    "view_case",
    "assign_case",
    "change_status",
    "message_reporter",
    "internal_note",
    "download_attachment",
    "view_audit",
    "change_own_password",
  ],
  // 审计员：只读，用于监督合规组本身。
  auditor: [
    "view_case",
    "view_audit",
    "export_audit",
    "change_own_password",
  ],
  // 平台管理员：只管账号与系统，业务侧只读。刻意不给"改状态"。
  admin: [
    "manage_staff",
    "view_audit",
    "change_own_password",
  ],
};

export function can(staff: repo.StaffRow | null, cap: Capability): boolean {
  if (!staff) return false;
  return MATRIX[staff.role].includes(cap);
}

/** 能否操作某个具体案件。调查员只能碰自己名下的。 */
export function canAccessCase(
  staff: repo.StaffRow | null,
  caseRow: repo.CaseRow,
  cap: Capability,
): boolean {
  if (!can(staff, cap)) return false;
  if (!staff) return false;
  if (staff.role === "investigator") {
    return caseRow.assigned_to === staff.id;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Fresh 中间件：把当前身份放进 ctx.state                              */
/* ------------------------------------------------------------------ */

export interface StateWithAuth extends State {
  staff: repo.StaffRow | null;
  reporter: repo.CaseRow | null;
  /** 每次请求都绑定的安全响应头由 securityHeaders 中间件统一加。 */
}

export const loadAuth: Middleware<StateWithAuth> = (ctx) => {
  ctx.state.staff = currentStaff(ctx.req);
  ctx.state.reporter = currentReporterCase(ctx.req)?.caseRow ?? null;
  return ctx.next();
};

/** 员工端统一登录校验。未登录一律跳登录页，不区分"无权限"与"不存在"。 */
export function requireStaff(
  ctx: { state: StateWithAuth; url: URL; redirect: (p: string) => Response },
  cap?: Capability,
): Response | repo.StaffRow {
  const staff = ctx.state.staff;
  if (!staff) {
    const next = encodeURIComponent(ctx.url.pathname + ctx.url.search);
    return ctx.redirect(`/staff/login?next=${next}`);
  }
  if (cap && !can(staff, cap)) {
    return new Response("无权访问", { status: 403 });
  }
  return staff;
}

/**
 * 从 query 里取一个「站内相对路径」作为登录后跳转目标。
 * 只接受以 /staff 开头的路径，杜绝开放重定向。
 */
export function safeStaffNext(next: string | null): string {
  if (!next) return "/staff";
  if (!next.startsWith("/staff") || next.startsWith("/staff/login")) {
    return "/staff";
  }
  try {
    const u = new URL(next, "http://local");
    if (u.origin !== "http://local") return "/staff";
    return u.pathname + u.search;
  } catch {
    return "/staff";
  }
}

/** 读取员工端当前登录者，未登录返回重定向响应。 */
export function staffOrRedirect(
  ctx: {
    state: State;
    url: URL;
    redirect: (p: string) => Response;
  },
): repo.StaffRow | Response {
  const staff = ctx.state.staff;
  if (!staff) {
    const next = encodeURIComponent(ctx.url.pathname + ctx.url.search);
    return ctx.redirect(`/staff/login?next=${next}`);
  }
  return staff;
}
