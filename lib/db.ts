// 数据库层。使用 Deno 内置的 node:sqlite（无外部依赖）。
//
// 匿名性相关的表结构约束：
// - 举报人侧（cases）与员工侧（staff、sessions、audit_log）之间，
//   唯一允许的连接是 cases.assignee_id 与 cases.created_by_staff_id 等
//   "员工→案件"的引用，绝不存在"案件→举报人"的字段。
// - cases 表没有 ip、ua、email、employee_id 等任何列。schema 本身就是承诺。

import { DatabaseSync } from "node:sqlite";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "jsr:@std/path@^1.1.2";
import { config } from "./config.ts";

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;

  mkdirSync(dirname(config.dbPath), { recursive: true, mode: 0o700 });
  mkdirSync(config.attachmentDir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dirname(config.dbPath), 0o700);
    chmodSync(config.dataDir, 0o700);
    chmodSync(config.attachmentDir, 0o700);
  } catch { /* ignore */ }

  const handle = new DatabaseSync(config.dbPath);
  if (config.dbPath !== ":memory:") {
    try {
      chmodSync(config.dbPath, 0o600);
    } catch { /* ignore */ }
  }

  handle.exec("PRAGMA journal_mode=WAL");
  handle.exec("PRAGMA synchronous=FULL");
  handle.exec("PRAGMA foreign_keys=ON");
  handle.exec("PRAGMA busy_timeout=5000");
  handle.exec("PRAGMA secure_delete=ON");

  migrate(handle);
  db = handle;
  return db;
}

/** 测试用：注入内存库并跳过文件系统硬化。 */
export function setDbForTest(handle: DatabaseSync): void {
  handle.exec("PRAGMA foreign_keys=ON");
  migrate(handle);
  db = handle;
}

export function resetDbForTest(): void {
  db = null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 案件。刻意不包含任何举报人侧的可识别字段。
CREATE TABLE IF NOT EXISTS cases (
  id                    TEXT PRIMARY KEY,
  case_number           TEXT NOT NULL UNIQUE,
  credential_hash       TEXT NOT NULL UNIQUE,
  category              TEXT NOT NULL,
  severity              TEXT NOT NULL,
  status                TEXT NOT NULL,
  subject               TEXT NOT NULL,
  body                  TEXT NOT NULL,
  -- 举报人侧时间：只到天
  submitted_day         TEXT NOT NULL,
  last_reporter_activity_day TEXT,
  -- 员工侧时间：精确到秒（员工不需要匿名）
  assigned_to           TEXT REFERENCES staff(id) ON DELETE SET NULL,
  assigned_by           TEXT REFERENCES staff(id) ON DELETE SET NULL,
  assigned_at           TEXT,
  closed_at             TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  -- 举报人主动设置的联系偏好，仅"是否需要回复"这类非身份信息
  reporter_wants_update  INTEGER NOT NULL DEFAULT 1,
  -- 举报人可在任意时刻撤回，撤回后正文仍保留以便审计，但不再出现在队列
  withdrawn_at          TEXT
);

CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);
CREATE INDEX IF NOT EXISTS idx_cases_assignee ON cases(assigned_to);
CREATE INDEX IF NOT EXISTS idx_cases_submitted ON cases(submitted_day);

-- 案件往来。direction: 'reporter' | 'staff'
-- 'reporter' 方向的时间只到天；'staff' 方向精确。
CREATE TABLE IF NOT EXISTS messages (
  -- seq 是自增序号，只用于按时间顺序展示，不参与任何身份关联。
  seq           INTEGER PRIMARY KEY AUTOINCREMENT,
  id            TEXT NOT NULL UNIQUE,
  case_id       TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  direction     TEXT NOT NULL CHECK (direction IN ('reporter','staff')),
  author_id     TEXT REFERENCES staff(id) ON DELETE SET NULL,
  body          TEXT NOT NULL,
  created_day   TEXT,
  created_at    TEXT,
  internal_only INTEGER NOT NULL DEFAULT 0,
  CHECK (
    (direction = 'reporter' AND created_day IS NOT NULL AND created_at IS NULL AND author_id IS NULL)
    OR
    (direction = 'staff' AND created_at IS NOT NULL AND created_day IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_messages_case ON messages(case_id, id);

-- 附件。存储名由服务端生成；original_name 一律清空，避免"文件名泄露身份"。
CREATE TABLE IF NOT EXISTS attachments (
  id            TEXT PRIMARY KEY,
  case_id       TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  message_id    TEXT REFERENCES messages(id) ON DELETE SET NULL,
  direction     TEXT NOT NULL CHECK (direction IN ('reporter','staff')),
  stored_name   TEXT NOT NULL UNIQUE,
  content_type  TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  sha256        TEXT NOT NULL,
  created_day   TEXT,
  created_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_attachments_case ON attachments(case_id);

-- 案件流转记录。给调查组看的时间线，全部是员工侧动作。
CREATE TABLE IF NOT EXISTS case_events (
  id          TEXT PRIMARY KEY,
  case_id     TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  actor_id    TEXT REFERENCES staff(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL,
  detail      TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_case ON case_events(case_id, id);

-- 员工账号。仅调查侧使用，与举报人数据完全隔离。
CREATE TABLE IF NOT EXISTS staff (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('investigator','lead','auditor','admin')),
  password_hash TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  last_login_at TEXT,
  -- 强制首次登录改密
  must_change_password INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash   TEXT PRIMARY KEY,
  staff_id     TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_staff ON sessions(staff_id);

-- 举报人会话：凭据通过校验后签发，避免每次操作都重新输入。
-- 令牌只存在 HttpOnly Cookie 里，库里只存摘要；与任何员工身份无关。
CREATE TABLE IF NOT EXISTS reporter_sessions (
  token_hash TEXT PRIMARY KEY,
  case_id    TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reporter_sessions_case ON reporter_sessions(case_id);

-- 审计日志：记录员工的一切敏感操作。绝不记录请求来源 IP/UA。
CREATE TABLE IF NOT EXISTS audit_log (
  id          TEXT PRIMARY KEY,
  actor_id    TEXT REFERENCES staff(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  target      TEXT,
  detail      TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

-- 登录限流：按用户名计数，不按 IP（记 IP 反而制造新的身份线索）。
CREATE TABLE IF NOT EXISTS login_throttle (
  username      TEXT PRIMARY KEY,
  failures      INTEGER NOT NULL DEFAULT 0,
  locked_until  TEXT
);
`;

function migrate(handle: DatabaseSync): void {
  handle.exec(SCHEMA);
  const row = handle
    .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
    .get() as { value: string } | undefined;
  if (!row) {
    handle.prepare(
      "INSERT INTO meta(key, value) VALUES ('schema_version', '1')",
    )
      .run();
  }
}

export interface DbRow {
  [key: string]: unknown;
}

/** 在单个事务里执行。node:sqlite 是同步 API，顺序天然安全。 */
export function tx<T>(fn: () => T): T {
  const d = getDb();
  d.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    d.exec("COMMIT");
    return out;
  } catch (err) {
    try {
      d.exec("ROLLBACK");
    } catch { /* ignore */ }
    throw err;
  }
}

/** 健康检查用。 */
export function dbExists(): boolean {
  return config.dbPath === ":memory:" || existsSync(config.dbPath);
}
