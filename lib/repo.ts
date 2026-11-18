// 数据访问层。所有 SQL 集中在这里，便于审计"有没有存不该存的东西"。

import { getDb, tx } from "./db.ts";
import { newId } from "./ids.ts";
import { dayBucket, preciseNow, reporterStamp } from "./time.ts";

export type CaseStatus =
  | "submitted"
  | "triage"
  | "investigating"
  | "awaiting_reporter"
  | "resolved"
  | "closed"
  | "withdrawn";

export interface CaseRow {
  id: string;
  case_number: string;
  credential_hash: string;
  category: string;
  severity: string;
  status: CaseStatus;
  subject: string;
  body: string;
  submitted_day: string;
  last_reporter_activity_day: string | null;
  assigned_to: string | null;
  assigned_by: string | null;
  assigned_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  reporter_wants_update: number;
  withdrawn_at: string | null;
}

export interface MessageRow {
  seq: number;
  id: string;
  case_id: string;
  direction: "reporter" | "staff";
  author_id: string | null;
  body: string;
  created_day: string | null;
  created_at: string | null;
  internal_only: number;
}

export interface AttachmentRow {
  id: string;
  case_id: string;
  message_id: string | null;
  direction: "reporter" | "staff";
  stored_name: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  created_day: string | null;
  created_at: string | null;
}

export interface StaffRow {
  id: string;
  username: string;
  display_name: string;
  role: "investigator" | "lead" | "auditor" | "admin";
  password_hash: string;
  active: number;
  created_at: string;
  last_login_at: string | null;
  must_change_password: number;
}

export type StaffRole = StaffRow["role"];

const q = (sql: string) => getDb().prepare(sql);

/* ------------------------------------------------------------------ */
/* 案件                                                                */
/* ------------------------------------------------------------------ */

export function createCase(input: {
  caseNumber: string;
  credentialHash: string;
  category: string;
  severity: string;
  subject: string;
  body: string;
}): CaseRow {
  const id = newId("case");
  const day = dayBucket();
  // created_at 刻意设为当天零点：案件表里不保存精确提交时刻，
  // 避免与门禁/打卡记录做时间关联。员工操作时间另记在 case_events。
  const createdAt = `${day}T00:00:00.000Z`;
  q(`INSERT INTO cases (
      id, case_number, credential_hash, category, severity, status,
      subject, body, submitted_day, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'submitted', ?, ?, ?, ?, ?)`)
    .run(
      id,
      input.caseNumber,
      input.credentialHash,
      input.category,
      input.severity,
      input.subject,
      input.body,
      day,
      createdAt,
      createdAt,
    );
  addEvent(id, null, "created", null);
  return getCaseById(id)!;
}

export function getCaseById(id: string): CaseRow | null {
  return (q("SELECT * FROM cases WHERE id = ?").get(id) as
    | CaseRow
    | undefined) ??
    null;
}

export function getCaseByCredentialHash(hash: string): CaseRow | null {
  return (q("SELECT * FROM cases WHERE credential_hash = ?").get(hash) as
    | CaseRow
    | undefined) ?? null;
}

export function getCaseByNumber(num: string): CaseRow | null {
  return (q("SELECT * FROM cases WHERE case_number = ?").get(num) as
    | CaseRow
    | undefined) ?? null;
}

export interface CaseListFilter {
  status?: CaseStatus | "open" | "all";
  assignee?: string | "unassigned" | "all";
  category?: string;
  q?: string;
}

/** 员工侧列表。返回时附上调查员显示名。 */
export function listCases(
  filter: CaseListFilter,
  limit = 200,
): (CaseRow & { assignee_name: string | null })[] {
  const where: string[] = [];
  const args: (string | number)[] = [];

  if (filter.status && filter.status !== "all") {
    if (filter.status === "open") {
      where.push("c.status NOT IN ('closed','withdrawn','resolved')");
    } else {
      where.push("c.status = ?");
      args.push(filter.status);
    }
  }
  if (filter.assignee && filter.assignee !== "all") {
    if (filter.assignee === "unassigned") where.push("c.assigned_to IS NULL");
    else {
      where.push("c.assigned_to = ?");
      args.push(filter.assignee);
    }
  }
  if (filter.category) {
    where.push("c.category = ?");
    args.push(filter.category);
  }
  if (filter.q) {
    where.push("(c.case_number LIKE ? OR c.subject LIKE ?)");
    args.push(`%${filter.q}%`, `%${filter.q}%`);
  }

  const sql = `SELECT c.*, s.display_name AS assignee_name
    FROM cases c LEFT JOIN staff s ON s.id = c.assigned_to
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY c.submitted_day DESC, c.case_number DESC
    LIMIT ?`;
  return q(sql).all(...args, limit) as unknown as (CaseRow & {
    assignee_name: string | null;
  })[];
}

export function assignCase(
  caseId: string,
  assigneeId: string | null,
  actorId: string,
): void {
  const now = preciseNow();
  q(`UPDATE cases SET assigned_to = ?, assigned_by = ?, assigned_at = ?, updated_at = ?
     WHERE id = ?`).run(assigneeId, actorId, now, now, caseId);
  addEvent(
    caseId,
    actorId,
    assigneeId ? "assigned" : "unassigned",
    assigneeId,
  );
}

export function setCaseStatus(
  caseId: string,
  status: CaseStatus,
  actorId: string | null,
  note?: string,
): void {
  const now = preciseNow();
  const closedAt =
    status === "closed" || status === "resolved" || status === "withdrawn"
      ? now
      : null;
  q(`UPDATE cases SET status = ?, updated_at = ?, closed_at = COALESCE(?, closed_at)
     WHERE id = ?`).run(status, now, closedAt, caseId);
  addEvent(caseId, actorId, "status", `${status}${note ? `:${note}` : ""}`);
}

export function withdrawCase(caseId: string): void {
  // 举报人触发：时间只到天，避免与门禁/打卡做时间关联。
  const now = reporterStamp();
  q(`UPDATE cases SET status = 'withdrawn', withdrawn_at = ?, updated_at = ?
     WHERE id = ?`).run(now, now, caseId);
  addEvent(caseId, null, "withdrawn", null);
}

export function touchReporterActivity(caseId: string): void {
  const day = dayBucket();
  q(`UPDATE cases SET last_reporter_activity_day = ? WHERE id = ?`).run(
    day,
    caseId,
  );
}

/* ------------------------------------------------------------------ */
/* 消息                                                                */
/* ------------------------------------------------------------------ */

export function addReporterMessage(
  caseId: string,
  body: string,
  messageId: string = newId("msg"),
): string {
  // 举报人消息只记录到"天"，且没有作者字段（作者就是凭据持有人）。
  q(`INSERT INTO messages (id, case_id, direction, body, created_day)
     VALUES (?, ?, 'reporter', ?, ?)`).run(
    messageId,
    caseId,
    body,
    dayBucket(),
  );
  touchReporterActivity(caseId);
  addEvent(caseId, null, "reporter_message", null);
  return messageId;
}

export function addStaffMessage(input: {
  caseId: string;
  staffId: string;
  body: string;
  internalOnly: boolean;
  messageId?: string;
}): string {
  const id = input.messageId ?? newId("msg");
  q(`INSERT INTO messages (id, case_id, direction, author_id, body, created_at, internal_only)
     VALUES (?, ?, 'staff', ?, ?, ?, ?)`).run(
    id,
    input.caseId,
    input.staffId,
    input.body,
    preciseNow(),
    input.internalOnly ? 1 : 0,
  );
  addEvent(
    input.caseId,
    input.staffId,
    input.internalOnly ? "internal_note" : "staff_message",
    null,
  );
  return id;
}

/** 举报人可见的消息：非内部备注。 */
export function listReporterMessages(caseId: string): MessageRow[] {
  return q(
    `SELECT * FROM messages
     WHERE case_id = ? AND internal_only = 0
     ORDER BY seq ASC`,
  ).all(caseId) as unknown as MessageRow[];
}

/** 员工可见全部消息。 */
export function listStaffMessages(caseId: string): MessageRow[] {
  return q(`SELECT * FROM messages WHERE case_id = ? ORDER BY seq ASC`)
    .all(caseId) as unknown as MessageRow[];
}

export function getMessage(id: string): MessageRow | null {
  return (q("SELECT * FROM messages WHERE id = ?").get(id) as
    | MessageRow
    | undefined) ?? null;
}

/* ------------------------------------------------------------------ */
/* 附件                                                                */
/* ------------------------------------------------------------------ */

export function addAttachment(input: {
  caseId: string;
  messageId: string | null;
  direction: "reporter" | "staff";
  storedName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  createdByDay?: string | null;
  createdAt?: string | null;
}): AttachmentRow {
  const id = newId("att").slice(4, 20);
  q(`INSERT INTO attachments (
      id, case_id, message_id, direction, stored_name, content_type,
      size_bytes, sha256, created_day, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id,
    input.caseId,
    input.messageId,
    input.direction,
    input.storedName,
    input.contentType,
    input.sizeBytes,
    input.sha256,
    input.direction === "reporter" ? (input.createdByDay ?? dayBucket()) : null,
    input.direction === "staff" ? (input.createdAt ?? preciseNow()) : null,
  );
  return getAttachment(id)!;
}

export function getAttachment(id: string): AttachmentRow | null {
  return (q("SELECT * FROM attachments WHERE id = ?").get(id) as
    | AttachmentRow
    | undefined) ?? null;
}

export function listAttachments(caseId: string): AttachmentRow[] {
  return q("SELECT * FROM attachments WHERE case_id = ? ORDER BY id ASC")
    .all(caseId) as unknown as AttachmentRow[];
}

/* ------------------------------------------------------------------ */
/* 案件时间线                                                          */
/* ------------------------------------------------------------------ */

export interface CaseEventRow {
  id: string;
  case_id: string;
  actor_id: string | null;
  kind: string;
  detail: string | null;
  created_at: string;
}

export function addEvent(
  caseId: string,
  actorId: string | null,
  kind: string,
  detail: string | null,
): void {
  // 没有 actor 的事件由举报人或系统触发，时间必须降到"天"。
  // 有 actor 的是员工操作，保留精确时间以便审计。
  const at = actorId === null ? reporterStamp() : preciseNow();
  q(`INSERT INTO case_events (id, case_id, actor_id, kind, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`).run(
    newId("ev"),
    caseId,
    actorId,
    kind,
    detail,
    at,
  );
}

export function listCaseEvents(caseId: string): CaseEventRow[] {
  return q("SELECT * FROM case_events WHERE case_id = ? ORDER BY id ASC")
    .all(caseId) as unknown as CaseEventRow[];
}

/* ------------------------------------------------------------------ */
/* 员工与登录                                                          */
/* ------------------------------------------------------------------ */

export function createStaff(input: {
  username: string;
  displayName: string;
  role: StaffRole;
  passwordHash: string;
  mustChangePassword?: boolean;
}): StaffRow {
  const id = newId("staff");
  q(`INSERT INTO staff (id, username, display_name, role, password_hash, created_at, must_change_password)
     VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    id,
    input.username,
    input.displayName,
    input.role,
    input.passwordHash,
    preciseNow(),
    input.mustChangePassword === false ? 0 : 1,
  );
  return getStaffById(id)!;
}

export function getStaffById(id: string): StaffRow | null {
  return (q("SELECT * FROM staff WHERE id = ?").get(id) as
    | StaffRow
    | undefined) ??
    null;
}

export function getStaffByUsername(username: string): StaffRow | null {
  return (q("SELECT * FROM staff WHERE username = ?").get(username) as
    | StaffRow
    | undefined) ?? null;
}

export function listStaff(): StaffRow[] {
  return q("SELECT * FROM staff ORDER BY role, username")
    .all() as unknown as StaffRow[];
}

export function countActiveStaff(): number {
  const row = q("SELECT COUNT(*) AS n FROM staff WHERE active = 1").get() as {
    n: number;
  };
  return row.n;
}

export function updateStaffPassword(id: string, hash: string): void {
  q("UPDATE staff SET password_hash = ?, must_change_password = 0 WHERE id = ?")
    .run(hash, id);
}

export function setStaffActive(id: string, active: boolean): void {
  q("UPDATE staff SET active = ? WHERE id = ?").run(active ? 1 : 0, id);
  if (!active) q("DELETE FROM sessions WHERE staff_id = ?").run(id);
}

export function updateStaffProfile(
  id: string,
  fields: { displayName?: string; role?: StaffRole },
): void {
  if (fields.displayName !== undefined) {
    q("UPDATE staff SET display_name = ? WHERE id = ?").run(
      fields.displayName,
      id,
    );
  }
  if (fields.role !== undefined) {
    q("UPDATE staff SET role = ? WHERE id = ?").run(fields.role, id);
  }
}

export function setStaffLastLogin(id: string): void {
  q("UPDATE staff SET last_login_at = ? WHERE id = ?").run(preciseNow(), id);
}

export function createStaffSession(
  tokenHash: string,
  staffId: string,
  expiresAt: string,
): void {
  q("INSERT INTO sessions (token_hash, staff_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .run(tokenHash, staffId, preciseNow(), expiresAt);
}

export function getStaffSession(
  tokenHash: string,
): { staff_id: string; expires_at: string } | null {
  return (q("SELECT staff_id, expires_at FROM sessions WHERE token_hash = ?")
    .get(tokenHash) as { staff_id: string; expires_at: string } | undefined) ??
    null;
}

export function deleteStaffSession(tokenHash: string): void {
  q("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
}

export function deleteSessionsForStaff(staffId: string): void {
  q("DELETE FROM sessions WHERE staff_id = ?").run(staffId);
}

export function purgeExpiredStaffSessions(): void {
  q("DELETE FROM sessions WHERE expires_at < ?").run(preciseNow());
}

/* ------------------------------------------------------------------ */
/* 举报人会话（凭据验证后签发，避免每次输入凭据）                       */
/* ------------------------------------------------------------------ */

export function createReporterSession(
  tokenHash: string,
  caseId: string,
  expiresAt: string,
): void {
  // created_at 用天级时间；expires_at 由调用方按"天 + N 天"计算，
  // 二者都不能携带精确时刻，否则可反推举报人的操作时间。
  q(`INSERT INTO reporter_sessions (token_hash, case_id, created_at, expires_at)
     VALUES (?, ?, ?, ?)`).run(tokenHash, caseId, reporterStamp(), expiresAt);
}

export function getReporterSession(
  tokenHash: string,
): { case_id: string; expires_at: string } | null {
  return (q(
    "SELECT case_id, expires_at FROM reporter_sessions WHERE token_hash = ?",
  )
    .get(tokenHash) as { case_id: string; expires_at: string } | undefined) ??
    null;
}

export function deleteReporterSession(tokenHash: string): void {
  q("DELETE FROM reporter_sessions WHERE token_hash = ?").run(tokenHash);
}

export function purgeExpiredReporterSessions(): void {
  q("DELETE FROM reporter_sessions WHERE expires_at < ?").run(preciseNow());
}

/* ------------------------------------------------------------------ */
/* 审计                                                                */
/* ------------------------------------------------------------------ */

export function audit(
  actorId: string | null,
  action: string,
  target: string | null,
  detail: string | null = null,
): void {
  q(`INSERT INTO audit_log (id, actor_id, action, target, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`).run(
    newId("aud"),
    actorId,
    action,
    target,
    detail,
    preciseNow(),
  );
}

export interface AuditRow {
  id: string;
  actor_id: string | null;
  action: string;
  target: string | null;
  detail: string | null;
  created_at: string;
  actor_name: string | null;
}

export function listAudit(limit = 200): AuditRow[] {
  return q(`SELECT a.*, s.display_name AS actor_name
     FROM audit_log a LEFT JOIN staff s ON s.id = a.actor_id
     ORDER BY a.created_at DESC, a.id DESC LIMIT ?`).all(
    limit,
  ) as unknown as AuditRow[];
}

/* ------------------------------------------------------------------ */
/* 登录限流                                                            */
/* ------------------------------------------------------------------ */

export function getLoginThrottle(
  username: string,
): { failures: number; locked_until: string | null } {
  const row = q(
    "SELECT failures, locked_until FROM login_throttle WHERE username = ?",
  )
    .get(username) as
      | { failures: number; locked_until: string | null }
      | undefined;
  return row ?? { failures: 0, locked_until: null };
}

export function recordLoginFailure(
  username: string,
  lockUntil: string | null,
): void {
  q(`INSERT INTO login_throttle (username, failures, locked_until) VALUES (?, 1, ?)
     ON CONFLICT(username) DO UPDATE SET failures = failures + 1, locked_until = ?`)
    .run(username, lockUntil, lockUntil);
}

export function clearLoginFailures(username: string): void {
  q("DELETE FROM login_throttle WHERE username = ?").run(username);
}

/* ------------------------------------------------------------------ */
/* 维护                                                                */
/* ------------------------------------------------------------------ */

/** 删除超过保留期的已结案案件（含消息、附件记录）。返回删除的案件 ID。 */
export function purgeClosedOlderThan(day: string): string[] {
  return tx(() => {
    const rows = q(
      `SELECT id FROM cases WHERE status = 'closed' AND submitted_day < ?`,
    ).all(day) as { id: string }[];
    for (const r of rows) {
      q("DELETE FROM cases WHERE id = ?").run(r.id);
    }
    return rows.map((r) => r.id);
  });
}

/** 统计信息（不含任何举报人信息）。 */
export function caseStats(): {
  total: number;
  open: number;
  unassigned: number;
  awaitingReporter: number;
} {
  const one = (sql: string) => (q(sql).get() as { n: number }).n;
  return {
    total: one("SELECT COUNT(*) AS n FROM cases"),
    open: one(
      "SELECT COUNT(*) AS n FROM cases WHERE status NOT IN ('closed','withdrawn','resolved')",
    ),
    unassigned: one(
      "SELECT COUNT(*) AS n FROM cases WHERE assigned_to IS NULL AND status NOT IN ('closed','withdrawn')",
    ),
    awaitingReporter: one(
      "SELECT COUNT(*) AS n FROM cases WHERE status = 'awaiting_reporter'",
    ),
  };
}

/** 级联删除案件及其消息/附件/事件记录（附件文件由调用方清理）。 */
export function deleteCaseCascade(caseId: string): void {
  q("DELETE FROM cases WHERE id = ?").run(caseId);
}

/**
 * 举报人回复后，把「等待你补充」改回「调查中」。
 * 该动作由举报人触发，actor 必须为 NULL——绝不能写入任何员工 ID。
 */
export function reopenByReporter(caseId: string): void {
  const now = reporterStamp();
  q(`UPDATE cases SET status = 'investigating', updated_at = ?
     WHERE id = ? AND status = 'awaiting_reporter'`).run(now, caseId);
  addEvent(caseId, null, "reporter_replied", null);
}
