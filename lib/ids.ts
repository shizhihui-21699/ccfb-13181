// 凭据与标识符生成。
//
// 设计要点：
// 1. 案件编号与"凭据"是两个独立的东西。编号可出现在内部工单里，凭据只有举报人持有。
// 2. 数据库里只存凭据的哈希（带 pepper 的 SHA-256），不存明文。库被拖走也无法冒用。
// 3. 采用 Crockford Base32，去掉 I/L/O/U，避免人工抄写歧义。
// 4. 凭据长 26 字符（130 bit 熵），离线爆破不可行。

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford Base32

export function encodeBase32(bytes: Uint8Array): string {
  let value = 0;
  let bits = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/**
 * 把用户输入的凭据规范化：统一大写，并把常见手抄混淆字符按 Crockford 规则还原。
 * 同时接受带分隔符的展示形式（如 XXXX-XXXX-...），以及用户可能粘贴的整段文本。
 */
export function normalizeCredential(input: string): string | null {
  const cleaned = input
    .toUpperCase()
    .replace(/[\s\-_.]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0")
    .replace(/U/g, "V");
  if (!/^[0-9A-HJKMNP-TV-Z]{25}$/.test(cleaned)) return null;
  return cleaned;
}

/** 展示形式：每 5 个字符一组，共 5 组，便于抄写核对。 */
export function formatCredential(raw: string): string {
  return raw.replace(/(.{5})(?=.)/g, "$1-");
}

/** 案件编号：WM-<年份>-<8位随机>。不含任何提交时间以外的信息。 */
export function newCaseNumber(now = new Date()): string {
  const y = now.getUTCFullYear();
  const rnd = encodeBase32(crypto.getRandomValues(new Uint8Array(5))).slice(
    0,
    8,
  );
  return `WM-${y}-${rnd}`;
}

/**
 * 新的凭据明文：25 个 Base32 字符 = 125 bit 熵。
 * 取 20 字节随机数（160 bit）后截断，保证每个字符都用满、无偏置。
 * 25 位正好分成 5 组，方便人工抄写核对。
 */
export function newCredential(): string {
  return encodeBase32(crypto.getRandomValues(new Uint8Array(20))).slice(0, 25);
}

/** 内部主键，与案件编号、凭据都无关。 */
export function newId(prefix: string): string {
  return `${prefix}_${
    encodeBase32(crypto.getRandomValues(new Uint8Array(16)))
  }`;
}

/**
 * 附件引用：展示给调查员用的短 ID。不参与任何路径拼接，
 * 存储路径由服务端按 case 计算，避免路径穿越与"探测文件名"类攻击。
 */
export function newAttachmentId(): string {
  return encodeBase32(crypto.getRandomValues(new Uint8Array(10))).slice(0, 16);
}
