// 哈希与密钥派生。
//
// 关键取舍：
// - 凭据、员工密码都必须"慢哈希"，否则数据库泄露后可离线爆破。
// - 案件凭据使用 HMAC-SHA256（带服务端 pepper）而不是 scrypt：
//   凭据本身有 128 bit 熵，暴力破解不现实；而每次查看进展都要校验，
//   用 scrypt 会把正常请求拖到几百毫秒，反而诱导运维调低参数。
//   为防库泄露后被离线比对，HMAC 的密钥单独存放在数据目录之外/权限更严。
// - 员工密码使用 scrypt（N=2^15），因为人工密码熵低，必须慢。

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "jsr:@std/path@^1.1.2";
import { config } from "./config.ts";

let pepperCache: Uint8Array | null = null;

function ensurePrivateDir(path: string) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  try {
    chmodSync(path, 0o700);
  } catch {
    // 某些文件系统不支持，忽略。
  }
}

/** 载入（或首次生成）服务端 pepper。缺少它，任何哈希都无法被离线复现。 */
export function pepper(): Uint8Array {
  if (pepperCache) return pepperCache;
  const path = config.pepperPath;
  ensurePrivateDir(dirname(path));

  if (!existsSync(path)) {
    const raw = randomBytes(32);
    writeFileSync(path, raw, { mode: 0o600 });
    try {
      chmodSync(path, 0o600);
    } catch { /* ignore */ }
    pepperCache = new Uint8Array(raw);
    return pepperCache;
  }

  const raw = readFileSync(path);
  if (raw.length < 32) {
    throw new Error(`pepper 文件损坏或过短：${path}`);
  }
  pepperCache = new Uint8Array(raw);
  return pepperCache;
}

/**
 * 凭据摘要。数据库只存这个值。
 * 加入 pepper，使得仅拿到数据库的攻击者无法离线验证猜测。
 */
export function hashCredential(normalized: string): string {
  return createHmac("sha256", pepper())
    .update("credential:v1:")
    .update(normalized)
    .digest("hex");
}

/** 员工会话令牌摘要。令牌本身只出现在 HttpOnly Cookie 里。 */
export function hashSessionToken(token: string): string {
  return createHmac("sha256", pepper())
    .update("session:v1:")
    .update(token)
    .digest("hex");
}

/** 普通 SHA-256，用于附件内容完整性（不涉及身份）。 */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** 员工密码：scrypt，参数随哈希一起存储，便于以后升级。 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const N = 1 << 15;
  const r = 8;
  const p = 1;
  const h = scryptSync(password.normalize("NFKC"), salt, 32, {
    N,
    r,
    p,
    maxmem: 128 * N * r * 2,
  });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64url")}$${
    h.toString("base64url")
  }`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const salt = Buffer.from(parts[4], "base64url");
    const expected = Buffer.from(parts[5], "base64url");
    const actual = scryptSync(
      password.normalize("NFKC"),
      salt,
      expected.length,
      {
        N,
        r,
        p,
        maxmem: 128 * N * r * 2,
      },
    );
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** 随机令牌（Cookie 用）。 */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** 定长比较，避免时序侧信道。 */
export function safeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * 附件加密。举报材料往往包含"只有少数人知道的细节"，落盘明文会让
 * 拿到备份的人直接读到内容。使用 AES-256-GCM，密钥由 pepper 派生。
 */
function attachmentKey(): Buffer {
  return Buffer.from(
    createHmac("sha256", pepper()).update("attachment-key:v1:").digest(),
  );
}

export function encryptBlob(plain: Uint8Array): Uint8Array {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", attachmentKey(), iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  const out = new Uint8Array(iv.length + tag.length + enc.length);
  out.set(iv, 0);
  out.set(tag, iv.length);
  out.set(enc, iv.length + tag.length);
  return out;
}

export function decryptBlob(blob: Uint8Array): Uint8Array {
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const data = blob.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", attachmentKey(), iv);
  decipher.setAuthTag(tag);
  return new Uint8Array(
    Buffer.concat([decipher.update(data), decipher.final()]),
  );
}
