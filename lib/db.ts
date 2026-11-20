import {
  generateCaseNumber,
  generateCaseSecret,
  hashSecret,
  newSalt,
  randomToken,
} from "./crypto.ts";

await Deno.mkdir("./data", { recursive: true }).catch(() => {});
export const kv = await Deno.openKv(Deno.env.get("KV_PATH") ?? "./data/kv.db");

// ---------------------------------------------------------------------------
// 模型
// ---------------------------------------------------------------------------

export type CaseStatus =
  | "new"
  | "triaged"
  | "investigating"
  | "awaiting_reporter"
  | "closed";

export const STATUS_LABELS: Record<CaseStatus, string> = {
  new: "待受理",
  triaged: "已受理",
  investigating: "调查中",
  awaiting_reporter: "待举报人补充",
  closed: "已结案",
};

export const STATUS_FLOW: CaseStatus[] = [
  "new",
  "triaged",
  "investigating",
  "awaiting_reporter",
  "closed",
];

export interface WhistleCase {
  number: string; // 公开案件编号,如 K7Q3-9M2X
  title: string;
  category: string;
  description: string;
  status: CaseStatus;
  day: string; // 提交日期,只精确到日(降低时间关联风险)
  secretSalt: string;
  secretHash: string; // 案件口令只存哈希,任何人(含管理员)都无法反推
  assignee: string | null; // 负责调查员用户名
  // 注意:这里刻意没有任何与举报人相关的字段
}

export interface CaseMessage {
  id: string;
  caseNumber: string;
  from: "reporter" | "staff";
  author: string | null; // 仅工作人员侧展示用;对举报人一律显示"调查人员"
  body: string;
  at: string; // ISO,分钟精度
  files: { id: string; name: string; size: number }[];
}

export interface CaseFileMeta {
  id: string;
  caseNumber: string;
  name: string;
  type: string;
  size: number;
  chunks: number;
  metaStripped: boolean;
}

export interface StaffUser {
  username: string;
  displayName: string;
  role: "admin" | "investigator";
  salt: string;
  passHash: string;
}

// ---------------------------------------------------------------------------
// 案件
// ---------------------------------------------------------------------------

function today(): string {
  return new Date().toISOString().slice(0, 10); // 只保留到日
}

export async function createCase(input: {
  title: string;
  category: string;
  description: string;
}): Promise<{ caseItem: WhistleCase; secret: string }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const number = generateCaseNumber();
    const secret = generateCaseSecret();
    const salt = newSalt();
    const caseItem: WhistleCase = {
      number,
      title: input.title,
      category: input.category,
      description: input.description,
      status: "new",
      day: today(),
      secretSalt: salt,
      secretHash: await hashSecret(secret, salt),
      assignee: null,
    };
    const res = await kv.atomic()
      .check({ key: ["cases", number], versionstamp: null })
      .set(["cases", number], caseItem)
      .set(["idx_status", "new", caseItem.day, number], true)
      .commit();
    if (res.ok) return { caseItem, secret };
  }
  throw new Error("无法分配案件编号,请重试");
}

export async function getCase(number: string): Promise<WhistleCase | null> {
  const res = await kv.get<WhistleCase>(["cases", number]);
  return res.value;
}

async function updateCase(
  number: string,
  mutate: (c: WhistleCase) => WhistleCase,
  reindex?: (
    oldC: WhistleCase,
    newC: WhistleCase,
    atomic: Deno.AtomicOperation,
  ) => void,
): Promise<boolean> {
  const key = ["cases", number];
  const res = await kv.get<WhistleCase>(key);
  if (!res.value) return false;
  const updated = mutate(res.value);
  const atomic = kv.atomic().check(res).set(key, updated);
  if (reindex) reindex(res.value, updated, atomic);
  return (await atomic.commit()).ok;
}

export async function setCaseStatus(
  number: string,
  status: CaseStatus,
): Promise<boolean> {
  return await updateCase(
    number,
    (c) => ({ ...c, status }),
    (oldC, newC, atomic) => {
      atomic.delete(["idx_status", oldC.status, oldC.day, number]);
      atomic.set(["idx_status", newC.status, newC.day, number], true);
    },
  );
}

export async function assignCase(
  number: string,
  assignee: string | null,
): Promise<boolean> {
  return await updateCase(
    number,
    (c) => ({ ...c, assignee }),
    (oldC, newC, atomic) => {
      if (oldC.assignee) {
        atomic.delete(["idx_assignee", oldC.assignee, oldC.day, number]);
      }
      if (newC.assignee) {
        atomic.set(["idx_assignee", newC.assignee, newC.day, number], true);
      }
    },
  );
}

export async function listCases(filter?: {
  status?: CaseStatus;
  assignee?: string;
}): Promise<WhistleCase[]> {
  const out: WhistleCase[] = [];
  if (filter?.status) {
    const iter = kv.list({ prefix: ["idx_status", filter.status] }, {
      reverse: true,
    });
    for await (const entry of iter) {
      const number = entry.key[entry.key.length - 1] as string;
      const c = await getCase(number);
      if (c && (!filter.assignee || c.assignee === filter.assignee)) {
        out.push(c);
      }
    }
    return out;
  }
  if (filter?.assignee) {
    const iter = kv.list({ prefix: ["idx_assignee", filter.assignee] }, {
      reverse: true,
    });
    for await (const entry of iter) {
      const number = entry.key[entry.key.length - 1] as string;
      const c = await getCase(number);
      if (c) out.push(c);
    }
    return out;
  }
  const iter = kv.list<WhistleCase>({ prefix: ["cases"] });
  for await (const entry of iter) out.push(entry.value);
  out.sort((a, b) =>
    b.day.localeCompare(a.day) || b.number.localeCompare(a.number)
  );
  return out;
}

// ---------------------------------------------------------------------------
// 消息
// ---------------------------------------------------------------------------

export async function addMessage(input: {
  caseNumber: string;
  from: "reporter" | "staff";
  author?: string | null;
  body: string;
  files?: { id: string; name: string; size: number }[];
}): Promise<CaseMessage> {
  // 键内时间只精确到分钟,避免留下高精度时间戳
  const minute = Math.floor(Date.now() / 60_000);
  const msg: CaseMessage = {
    id: `${minute}_${randomToken(6)}`,
    caseNumber: input.caseNumber,
    from: input.from,
    author: input.author ?? null,
    body: input.body,
    at: new Date(minute * 60_000).toISOString().slice(0, 16).replace("T", " ") +
      " UTC",
    files: input.files ?? [],
  };
  await kv.set(["messages", input.caseNumber, msg.id], msg);
  return msg;
}

export async function listMessages(caseNumber: string): Promise<CaseMessage[]> {
  const out: CaseMessage[] = [];
  const iter = kv.list<CaseMessage>({ prefix: ["messages", caseNumber] });
  for await (const entry of iter) out.push(entry.value);
  return out;
}

// ---------------------------------------------------------------------------
// 文件(KV 单值上限 64KiB,分块存储)
// ---------------------------------------------------------------------------

const CHUNK_SIZE = 60_000;

export async function saveFile(input: {
  caseNumber: string;
  name: string;
  type: string;
  data: Uint8Array;
  metaStripped: boolean;
}): Promise<CaseFileMeta> {
  const id = randomToken(16);
  const chunks = Math.max(1, Math.ceil(input.data.length / CHUNK_SIZE));
  const meta: CaseFileMeta = {
    id,
    caseNumber: input.caseNumber,
    name: input.name,
    type: input.type,
    size: input.data.length,
    chunks,
    metaStripped: input.metaStripped,
  };
  const atomic = kv.atomic().set(["files", id, "meta"], meta);
  for (let i = 0; i < chunks; i++) {
    atomic.set(
      ["files", id, "data", i],
      input.data.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
    );
  }
  await atomic.commit();
  return meta;
}

export async function getFileMeta(id: string): Promise<CaseFileMeta | null> {
  const res = await kv.get<CaseFileMeta>(["files", id, "meta"]);
  return res.value;
}

export async function readFileData(meta: CaseFileMeta): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for (let i = 0; i < meta.chunks; i++) {
    const res = await kv.get<Uint8Array>(["files", meta.id, "data", i]);
    if (!res.value) throw new Error("文件数据缺失");
    parts.push(res.value);
  }
  const out = new Uint8Array(meta.size);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 工作人员账号
// ---------------------------------------------------------------------------

export async function createStaffUser(input: {
  username: string;
  displayName: string;
  role: "admin" | "investigator";
  password: string;
}): Promise<void> {
  const salt = newSalt();
  const user: StaffUser = {
    username: input.username,
    displayName: input.displayName,
    role: input.role,
    salt,
    passHash: await hashSecret(input.password, salt),
  };
  const res = await kv.atomic()
    .check({ key: ["users", input.username], versionstamp: null })
    .set(["users", input.username], user)
    .commit();
  if (!res.ok) throw new Error(`用户 ${input.username} 已存在`);
}

export async function getStaffUser(
  username: string,
): Promise<StaffUser | null> {
  const res = await kv.get<StaffUser>(["users", username]);
  return res.value;
}

export async function listStaffUsers(): Promise<StaffUser[]> {
  const out: StaffUser[] = [];
  const iter = kv.list<StaffUser>({ prefix: ["users"] });
  for await (const entry of iter) out.push(entry.value);
  return out;
}

// ---------------------------------------------------------------------------
// 会话(只存随机令牌 → 最小必要信息的映射,过期自动清除)
// ---------------------------------------------------------------------------

const STAFF_SESSION_TTL = 12 * 60 * 60 * 1000; // 12 小时
const REPORTER_SESSION_TTL = 2 * 60 * 60 * 1000; // 2 小时

export async function createStaffSession(username: string): Promise<string> {
  const token = randomToken();
  await kv.set(["staff_sessions", token], { username }, {
    expireIn: STAFF_SESSION_TTL,
  });
  return token;
}

export async function getStaffBySession(
  token: string,
): Promise<StaffUser | null> {
  const res = await kv.get<{ username: string }>(["staff_sessions", token]);
  if (!res.value) return null;
  return await getStaffUser(res.value.username);
}

export async function deleteStaffSession(token: string): Promise<void> {
  await kv.delete(["staff_sessions", token]);
}

export async function createReporterSession(
  caseNumber: string,
): Promise<string> {
  const token = randomToken();
  await kv.set(["reporter_sessions", token], { caseNumber }, {
    expireIn: REPORTER_SESSION_TTL,
  });
  return token;
}

export async function getReporterSessionCase(
  token: string,
): Promise<string | null> {
  const res = await kv.get<{ caseNumber: string }>([
    "reporter_sessions",
    token,
  ]);
  return res.value?.caseNumber ?? null;
}

// ---------------------------------------------------------------------------
// 限流(不基于 IP —— IP 属于可定位信息,一律不记录;改用全局/按案件/按账号桶)
// ---------------------------------------------------------------------------

export async function rateLimit(
  bucket: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  const window = Math.floor(Date.now() / windowMs);
  const key = ["ratelimit", bucket, window];
  const cur = await kv.get<number>(key);
  const n = (cur.value ?? 0) + 1;
  await kv.set(key, n, { expireIn: windowMs * 2 });
  return n <= limit;
}
