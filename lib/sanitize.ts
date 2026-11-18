// 附件净化：在上传落盘之前，把能定位到人的信息从文件里剥掉。
//
// 文件本身是最容易被忽视的"实名材料"：
//   - 手机拍的照片带 EXIF：GPS 坐标、设备型号、拍摄时间、甚至镜头序列号
//   - Word/PDF 带作者、公司、最后修改人、打印机名
//   - 截图带原始文件名、Windows 用户名
//
// 策略：
//   1. 只按"文件头魔数"判断类型，不信扩展名和 Content-Type。
//   2. 只接受可以彻底净化的类型（PNG/JPEG/WebP/PDF/纯文本）。
//      其它类型（docx/xlsx/heic/zip）一律拒绝，并提示"请另存为 PDF"，
//      因为 Office 文档的作者信息散落在多个 XML part 里，纯前端清除不可靠。
//   3. 原始文件名不保存、不落盘、不回显。
//   4. 即使净化后，图片"画面内容"仍可能暴露身份（工牌、反光、窗外景物），
//      这一点在界面上明确提醒，不做虚假承诺。

export class SanitizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SanitizeError";
  }
}

export interface SanitizedFile {
  bytes: Uint8Array;
  contentType: string;
  extension: string;
  kind: "png" | "jpeg" | "webp" | "pdf" | "text";
  /** 净化过程中去掉的东西，用于给举报人一句可理解的反馈。 */
  removed: string[];
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MAX_TEXT_BYTES = 1024 * 1024;

function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  if (bytes.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (bytes[i] !== sig[i]) return false;
  return true;
}

function ascii(bytes: Uint8Array, start: number, len: number): string {
  return new TextDecoder("latin1").decode(bytes.subarray(start, start + len));
}

function u32be(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

function u32le(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

function putU32le(out: Uint8Array, o: number, v: number) {
  out[o] = v & 255;
  out[o + 1] = (v >>> 8) & 255;
  out[o + 2] = (v >>> 16) & 255;
  out[o + 3] = (v >>> 24) & 255;
}

/** PNG：丢弃所有元数据 ancillary chunk，保留像素数据。 */
function sanitizePng(bytes: Uint8Array): SanitizedFile {
  // 允许保留的 chunk：渲染必需或纯色彩信息，不含文本/时间/设备信息。
  const keep = new Set([
    "IHDR",
    "PLTE",
    "IDAT",
    "IEND",
    "tRNS",
    "gAMA",
    "cHRM",
    "sRGB",
    "bKGD",
    "pHYs",
    "sBIT",
    "hIST",
  ]);
  const removed: string[] = [];
  const out: number[] = Array.from(PNG_SIG);
  let off = 8;
  let sawIhdr = false;
  let sawIend = false;

  while (off + 12 <= bytes.length) {
    const len = u32be(bytes, off);
    const type = ascii(bytes, off + 4, 4);
    const end = off + 12 + len;
    if (len > bytes.length || end > bytes.length) {
      throw new SanitizeError("PNG 文件已损坏，无法安全净化。");
    }
    const isCritical = type[0] === type[0].toUpperCase();
    if (isCritical && !keep.has(type)) {
      throw new SanitizeError("PNG 含无法处理的关键数据块，已拒绝。");
    }
    if (keep.has(type)) {
      // 原样复制（含长度、类型、数据、CRC），CRC 仍然有效。
      for (let i = off; i < end; i++) out.push(bytes[i]);
    } else {
      removed.push(type.trim());
    }
    if (type === "IHDR") sawIhdr = true;
    if (type === "IEND") {
      sawIend = true;
      break;
    }
    off = end;
  }

  if (!sawIhdr || !sawIend) throw new SanitizeError("PNG 结构不完整，已拒绝。");
  return {
    bytes: new Uint8Array(out),
    contentType: "image/png",
    extension: "png",
    kind: "png",
    removed,
  };
}

/** JPEG：去掉 EXIF/XMP/IPTC/注释段。 */
function sanitizeJpeg(bytes: Uint8Array): SanitizedFile {
  const removed: string[] = [];
  const out: number[] = [0xff, 0xd8];
  let off = 2;

  while (off < bytes.length) {
    if (bytes[off] !== 0xff) throw new SanitizeError("JPEG 结构异常，已拒绝。");
    // 允许填充 0xFF
    while (bytes[off] === 0xff) off++;
    const marker = bytes[off];
    off++;

    // 无载荷标记
    if (
      marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)
    ) {
      out.push(0xff, marker);
      continue;
    }
    // 图像数据开始：之后整体复制，不再解析
    if (marker === 0xda) {
      out.push(0xff, marker);
      for (let i = off; i < bytes.length; i++) out.push(bytes[i]);
      break;
    }
    // EOI
    if (marker === 0xd9) {
      out.push(0xff, marker);
      break;
    }
    if (off + 2 > bytes.length) throw new SanitizeError("JPEG 截断，已拒绝。");
    const len = (bytes[off] << 8) | bytes[off + 1];
    if (len < 2 || off + len > bytes.length) {
      throw new SanitizeError("JPEG 段长度异常，已拒绝。");
    }

    // APP0(JFIF) 与 APP14(Adobe) 只含色彩/版本信息，保留。
    // APP1..APP13/APP15 可能含 EXIF、XMP、IPTC、Photoshop 资源、GPS。
    const isApp = marker >= 0xe0 && marker <= 0xef;
    const drop = (isApp && marker !== 0xe0 && marker !== 0xee) ||
      marker === 0xfe;
    if (drop) {
      removed.push(marker === 0xfe ? "COM" : `APP${marker - 0xe0}`);
      off += len;
      continue;
    }

    out.push(0xff, marker);
    for (let i = off; i < off + len; i++) out.push(bytes[i]);
    off += len;
  }

  return {
    bytes: new Uint8Array(out),
    contentType: "image/jpeg",
    extension: "jpg",
    kind: "jpeg",
    removed,
  };
}

/**
 * WebP：RIFF 容器，去掉 EXIF/XMP/ICC 块，并同步清除 VP8X 里对应的标志位。
 * 只清块不标志位会让部分解码器认为文件损坏。
 */
function sanitizeWebp(bytes: Uint8Array): SanitizedFile {
  const removed: string[] = [];
  const chunks: { fourcc: string; payload: Uint8Array }[] = [];
  let off = 12;
  while (off + 8 <= bytes.length) {
    const fourcc = ascii(bytes, off, 4);
    const size = u32le(bytes, off + 4);
    const end = off + 8 + size;
    if (end > bytes.length) throw new SanitizeError("WebP 结构异常，已拒绝。");
    const payload = bytes.slice(off + 8, end);
    if (fourcc === "EXIF" || fourcc === "XMP " || fourcc === "ICCP") {
      removed.push(fourcc.trim());
    } else {
      chunks.push({ fourcc, payload });
    }
    off = end + (size & 1);
  }

  for (const c of chunks) {
    if (c.fourcc === "VP8X" && c.payload.length >= 1) {
      // 位定义（从高位起）：Rsv Rsv I L E X A R
      c.payload[0] &= ~(0x20 | 0x08 | 0x04); // 清 ICC / EXIF / XMP
    }
  }

  const body: number[] = [];
  for (const c of chunks) {
    for (const ch of c.fourcc) body.push(ch.charCodeAt(0));
    const size = c.payload.length;
    body.push(
      size & 255,
      (size >>> 8) & 255,
      (size >>> 16) & 255,
      (size >>> 24) & 255,
    );
    for (const b of c.payload) body.push(b);
    if (size & 1) body.push(0);
  }

  const total = 4 + body.length; // "WEBP" + chunks
  const out = new Uint8Array(8 + total);
  out.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  putU32le(out, 4, total);
  out.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  out.set(new Uint8Array(body), 12);

  return {
    bytes: out,
    contentType: "image/webp",
    extension: "webp",
    kind: "webp",
    removed,
  };
}

/** PDF：清空 Info 字典与 XMP 元数据流。 */
async function sanitizePdf(bytes: Uint8Array): Promise<SanitizedFile> {
  const { PDFDocument, PDFName } = await import("pdf-lib");
  let doc;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch {
    throw new SanitizeError(
      "PDF 无法解析（可能已加密），请另存为普通 PDF 后重试。",
    );
  }

  doc.setAuthor("");
  doc.setTitle("");
  doc.setSubject("");
  doc.setCreator("");
  doc.setProducer("");
  doc.setKeywords([]);

  try {
    doc.catalog.delete(PDFName.of("Metadata"));
  } catch { /* 没有就忽略 */ }

  // 保留原始页面内容，不做栅格化。关闭对象流，确保元数据键被真正移除。
  const out = await doc.save({ useObjectStreams: false });
  return {
    bytes: out,
    contentType: "application/pdf",
    extension: "pdf",
    kind: "pdf",
    removed: ["Info 作者/标题", "XMP"],
  };
}

/** 纯文本：只做编码规范化。内容本身是否暴露身份由举报人自己决定。 */
function sanitizeText(bytes: Uint8Array): SanitizedFile {
  if (bytes.length > MAX_TEXT_BYTES) {
    throw new SanitizeError("纯文本附件上限 1 MiB。");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new SanitizeError("文本不是 UTF-8 编码，请另存为 UTF-8 后再试。");
  }
  text = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const out = new TextEncoder().encode(text);
  return {
    bytes: out,
    contentType: "text/plain; charset=utf-8",
    extension: "txt",
    kind: "text",
    removed: [],
  };
}

/** 主入口：根据魔数选择净化器。 */
export async function sanitizeUpload(
  input: Uint8Array,
): Promise<SanitizedFile> {
  if (input.length === 0) throw new SanitizeError("空文件。");

  if (startsWith(input, PNG_SIG)) return sanitizePng(input);
  if (startsWith(input, [0xff, 0xd8, 0xff])) return sanitizeJpeg(input);
  if (
    input.length >= 12 && ascii(input, 0, 4) === "RIFF" &&
    ascii(input, 8, 4) === "WEBP"
  ) {
    return sanitizeWebp(input);
  }
  if (ascii(input, 0, 5) === "%PDF-") return await sanitizePdf(input);

  // 含 NUL 的按二进制处理，不接受
  const probe = input.subarray(0, Math.min(4096, input.length));
  if (!probe.includes(0)) {
    // 可能是纯文本；但也要排除 HTML/SVG 这类可在浏览器里执行的内容
    const head = new TextDecoder("utf-8", { fatal: false }).decode(probe)
      .trimStart();
    if (/^(<!doctype|<html|<svg|<script|<\?xml)/i.test(head)) {
      throw new SanitizeError(
        "不接受网页/SVG/XML 文件。请截图或另存为 PDF 后上传。",
      );
    }
    return sanitizeText(input);
  }

  throw new SanitizeError(
    "只接受 PNG、JPEG、WebP 图片、PDF 或纯文本。Office 文档会带作者信息，请先另存为 PDF。",
  );
}

/** 给用户看的一句话说明。 */
export function describeSanitization(f: SanitizedFile): string {
  if (f.kind === "text") return "已按 UTF-8 规范化。";
  if (f.kind === "pdf") return "已清除 PDF 的作者、标题、创建工具等元数据。";
  if (f.removed.length === 0) return "未发现可清除的元数据。";
  return `已清除 ${f.removed.length} 项元数据（如拍摄地点、设备型号、编辑记录）。`;
}
