// 附件净化测试。
//
// 这些用例构造"带身份证"的文件，验证净化后那些标识确实消失。
// 同时对不该接受的文件类型做了负面测试。

import "./setup.ts";
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@^1.0.0";
import {
  describeSanitization,
  SanitizeError,
  sanitizeUpload,
} from "../lib/sanitize.ts";

/** 构造一个最小 PNG，附带 tEXt / tIME / eXIf 块。 */
function pngWithMetadata(): Uint8Array {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const chunks: number[] = [];

  const crc32 = (bytes: number[]): number => {
    let c = ~0;
    for (const b of bytes) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const addChunk = (type: string, data: number[]) => {
    const len = data.length;
    const typeBytes = [...type].map((ch) => ch.charCodeAt(0));
    chunks.push(
      (len >>> 24) & 255,
      (len >>> 16) & 255,
      (len >>> 8) & 255,
      len & 255,
    );
    chunks.push(...typeBytes, ...data);
    const crc = crc32([...typeBytes, ...data]);
    chunks.push(
      (crc >>> 24) & 255,
      (crc >>> 16) & 255,
      (crc >>> 8) & 255,
      crc & 255,
    );
  };

  // IHDR: 1x1 RGB
  addChunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
  // 故意放入可识别信息
  const text = new TextEncoder().encode("Author\0张伟 工号 A10086");
  addChunk("tEXt", [...text]);
  addChunk("tIME", [0x07, 0xe6, 0x0b, 0x12, 0x0a, 0x1e, 0x2d]);
  addChunk("eXIf", [0x49, 0x49, 0x2a, 0x00, 0x08, 0, 0, 0]);
  // IDAT: 最小 zlib 流（1 像素）
  addChunk("IDAT", [
    0x78,
    0x9c,
    0x62,
    0x00,
    0x01,
    0x00,
    0x00,
    0x05,
    0x00,
    0x01,
  ]);
  addChunk("IEND", []);

  return new Uint8Array([...sig, ...chunks]);
}

/** 构造一个带 EXIF APP1 的最小 JPEG。 */
function jpegWithExif(): Uint8Array {
  const out: number[] = [0xff, 0xd8];

  // APP1 / Exif，内含 ASCII "GPS 39.9042N 116.4074E"
  const payload = new TextEncoder().encode("Exif\0\0GPS 39.9042N 116.4074E");
  const len = payload.length + 2;
  out.push(0xff, 0xe1, (len >> 8) & 255, len & 255, ...payload);

  // APP0 / JFIF（应保留）
  const app0 = [
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00,
    0x01,
    0x01,
    0x00,
    0x00,
    0x01,
    0x00,
    0x01,
    0x00,
    0x00,
  ];
  out.push(0xff, 0xe0, 0x00, app0.length + 2, ...app0);

  // COM 注释段
  const com = new TextEncoder().encode("shot by 张三 iPhone");
  out.push(0xff, 0xfe, (com.length + 2) >> 8, (com.length + 2) & 255, ...com);

  // 合成 SOS + 数据 + EOI（内容不重要，只要结构可解析）
  out.push(0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0x00, 0x01, 0x02, 0x03);
  out.push(0xff, 0xd9);
  return new Uint8Array(out);
}

const latin1 = (b: Uint8Array) => new TextDecoder("latin1").decode(b);

Deno.test("PNG：清除 tEXt/tIME/eXIf，保留像素数据", async () => {
  const input = pngWithMetadata();
  assert(latin1(input).includes("A10086"));

  const out = await sanitizeUpload(input);
  const text = latin1(out.bytes);

  assert(!text.includes("A10086"), "工号仍然存在");
  assert(!text.includes("张伟"), "姓名仍然存在");
  assert(!text.includes("tEXt"), "tEXt 块仍然存在");
  assert(!text.includes("eXIf"), "eXIf 块仍然存在");
  assert(text.includes("IHDR"));
  assert(text.includes("IDAT"));
  assert(text.includes("IEND"));
  assertEquals(out.kind, "png");
  assert(out.removed.length >= 3);
});

Deno.test("JPEG：清除 EXIF 与注释，保留 JFIF 与图像数据", async () => {
  const input = jpegWithExif();
  const out = await sanitizeUpload(input);
  const text = latin1(out.bytes);

  assert(!text.includes("39.9042N"), "GPS 仍然存在");
  assert(!text.includes("张三"), "姓名仍然存在");
  assert(!text.includes("Exif"), "EXIF 段仍然存在");
  assert(text.includes("JFIF"), "JFIF 应保留");
  // 图像数据仍然存在（SOS 标记）
  assert(out.bytes.includes(0xda));
  assertEquals(out.kind, "jpeg");
});

Deno.test("PDF：清除作者/标题/生产者等元数据", async () => {
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  doc.setAuthor("王五");
  doc.setTitle("内部工资表");
  doc.setProducer("Acme 打印驱动");
  doc.setCreator("Word 2019");
  doc.setSubject("机密");
  doc.addPage();
  const pdfBytes = await doc.save();

  const out = await sanitizeUpload(new Uint8Array(pdfBytes));
  const text = latin1(out.bytes);

  assert(!text.includes("王五"), "作者仍然存在");
  assert(!text.includes("内部工资表"), "标题仍然存在");
  assert(!text.includes("Acme"), "生产者仍然存在");
  assertEquals(out.kind, "pdf");
});

Deno.test("纯文本：UTF-8 规范化，CRLF 转 LF，去 BOM", async () => {
  const raw = new TextEncoder().encode("﻿第一行\r\n第二行\r\n");
  const out = await sanitizeUpload(raw);
  const text = new TextDecoder().decode(out.bytes);
  assertEquals(text, "第一行\n第二行\n");
  assertEquals(out.kind, "text");
});

Deno.test("拒绝 Office / 压缩包 / 可执行文件等无法可靠净化的类型", async () => {
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
  await assertRejects(() => sanitizeUpload(zip), SanitizeError, "只接受");

  const elf = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0, 0, 0, 0]);
  await assertRejects(() => sanitizeUpload(elf), SanitizeError);
});

Deno.test("拒绝 HTML / SVG（可执行内容）", async () => {
  const html = new TextEncoder().encode(
    "<!doctype html><script>alert(1)</script>",
  );
  await assertRejects(() => sanitizeUpload(html), SanitizeError, "网页");

  const svg = new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
  );
  await assertRejects(() => sanitizeUpload(svg), SanitizeError, "SVG");
});

Deno.test("空文件被拒绝", async () => {
  await assertRejects(() => sanitizeUpload(new Uint8Array(0)), SanitizeError);
});

Deno.test("损坏的 PNG 被拒绝，而不是原样透传", async () => {
  const broken = new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    0xff,
  ]);
  await assertRejects(() => sanitizeUpload(broken), SanitizeError);
});

Deno.test("给用户的净化说明可读且不泄露内容", async () => {
  const out = await sanitizeUpload(pngWithMetadata());
  const desc = describeSanitization(out);
  assert(desc.length > 0);
  assert(!desc.includes("张伟"));
});
