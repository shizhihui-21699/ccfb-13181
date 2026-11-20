/**
 * 上传文件的元数据清理 + 文本中的联系方式检测。
 * 本模块不依赖任何 Deno API,island(浏览器端)也可直接引用。
 */

/** JPEG:删除所有 APPn(EXIF/XMP/缩略图)与 COM(注释)段,只保留解码必需段 */
export function stripJpegMetadata(data: Uint8Array): Uint8Array | null {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null;
  const out: number[] = [0xff, 0xd8];
  let i = 2;
  while (i + 1 < data.length) {
    if (data[i] !== 0xff) return null; // 非预期结构,放弃处理
    const marker = data[i + 1];
    if (marker === 0xda) {
      // SOS(图像数据开始):段头 + 其后全部内容原样保留
      if (i + 3 >= data.length) return null;
      const len = (data[i + 2] << 8) | data[i + 3];
      if (len < 2 || i + 2 + len > data.length) return null;
      for (let j = i; j < data.length; j++) out.push(data[j]);
      return new Uint8Array(out);
    }
    // 无长度独立标记:SOI/EOI/RSTn/TEM
    if (
      marker === 0xd8 || marker === 0xd9 || marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      out.push(0xff, marker);
      i += 2;
      continue;
    }
    if (i + 3 >= data.length) return null;
    const len = (data[i + 2] << 8) | data[i + 3];
    if (len < 2 || i + 2 + len > data.length) return null;
    const isApp = marker >= 0xe0 && marker <= 0xef; // APP0~APP15
    const isCom = marker === 0xfe; // 注释
    if (!isApp && !isCom) {
      for (let j = i; j < i + 2 + len; j++) out.push(data[j]);
    }
    i += 2 + len;
  }
  return new Uint8Array(out);
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// 只保留关键块:IHDR/PLTE/IDAT/IEND;丢弃 tEXt/zTXt/iTXt/eXIf/tIME/iCCP 等所有辅助块
const PNG_KEEP = new Set(["IHDR", "PLTE", "IDAT", "IEND"]);

/** PNG:只保留解码必需的关键块 */
export function stripPngMetadata(data: Uint8Array): Uint8Array | null {
  if (data.length < 8 || !PNG_SIG.every((b, i) => data[i] === b)) return null;
  const out: number[] = [...PNG_SIG];
  let i = 8;
  while (i + 8 <= data.length) {
    const len = ((data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) |
      data[i + 3]) >>> 0;
    const type = String.fromCharCode(
      data[i + 4],
      data[i + 5],
      data[i + 6],
      data[i + 7],
    );
    if (i + 12 + len > data.length) return null;
    if (PNG_KEEP.has(type)) {
      for (let j = i; j < i + 12 + len; j++) out.push(data[j]);
    }
    i += 12 + len;
    if (type === "IEND") break;
  }
  return new Uint8Array(out);
}

export interface SanitizedUpload {
  data: Uint8Array;
  /** 元数据是否已被确认清除(仅 JPEG/PNG 为 true) */
  metaStripped: boolean;
  /** 给操作者的提示 */
  note: string | null;
}

/** 按类型清理上传文件;无法自动清理的类型原样放行并给出警示 */
export function sanitizeUpload(
  contentType: string,
  data: Uint8Array,
): SanitizedUpload | null {
  if (contentType === "image/jpeg") {
    const stripped = stripJpegMetadata(data);
    if (!stripped) return null; // 结构异常,拒绝
    return { data: stripped, metaStripped: true, note: null };
  }
  if (contentType === "image/png") {
    const stripped = stripPngMetadata(data);
    if (!stripped) return null;
    return { data: stripped, metaStripped: true, note: null };
  }
  return {
    data,
    metaStripped: false,
    note: "该文件类型的元数据无法自动清除,文件属性中可能包含作者、设备等信息",
  };
}

/** 允许上传的类型 */
export const ALLOWED_FILE_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "application/pdf": ".pdf",
  "text/plain": ".txt",
  "application/zip": ".zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    ".docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
};

export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

const CONTACT_PATTERNS: [RegExp, string][] = [
  [/[\w.+-]+@[\w-]+\.[\w.]+/, "邮箱地址"],
  [/(?<!\d)1[3-9]\d{9}(?!\d)/, "手机号码"],
  [/(?<!\d)\d{17}[\dXx](?!\d)/, "身份证号"],
  [/(?:微信|wechat|wx)\s*[:：]?\s*[a-zA-Z][\w-]{5,19}/i, "微信号"],
  [/(?:工号|员工号|职员号)\s*[:：]?\s*[A-Za-z0-9-]{3,}/, "工号"],
];

/** 检测文本中可能暴露身份的信息,返回命中的类别(只警告,不拦截) */
export function detectContactInfo(text: string): string[] {
  const hits = new Set<string>();
  for (const [re, label] of CONTACT_PATTERNS) {
    if (re.test(text)) hits.add(label);
  }
  return [...hits];
}
