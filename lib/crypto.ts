const encoder = new TextEncoder();

/** URL 安全的随机令牌 */
export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let s = "";
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

// 去掉 0/O、1/I/L 等易混淆字符,方便人工抄写
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function randomChars(n: number): string {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  let s = "";
  for (const b of buf) s += ALPHABET[b % ALPHABET.length];
  return s;
}

/** 案件编号,形如 K7Q3-9M2X */
export function generateCaseNumber(): string {
  return `${randomChars(4)}-${randomChars(4)}`;
}

/** 案件口令,形如 4F2K-Q8MN-3RXT */
export function generateCaseSecret(): string {
  return `${randomChars(4)}-${randomChars(4)}-${randomChars(4)}`;
}

/** 用户输入归一化:去空白、转大写,避免抄写时大小写不一致导致无法登录 */
export function normalizeCredential(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, "");
}

export function newSalt(): string {
  return randomToken(16);
}

/** PBKDF2-SHA256,21 万次迭代。口令只存哈希,数据库泄露也无法反推 */
export async function hashSecret(
  secret: string,
  salt: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret.normalize("NFKC")),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: encoder.encode(salt),
      iterations: 210_000,
    },
    key,
    256,
  );
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifySecret(
  secret: string,
  salt: string,
  expectedHex: string,
): Promise<boolean> {
  const actual = await hashSecret(secret, salt);
  return timingSafeEqual(actual, expectedHex);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
