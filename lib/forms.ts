// 表单解析。
//
// 重要：在读取 body 之前先看 Content-Length，超限直接拒绝，
// 避免攻击者用一个巨大的 multipart 把内存打满。
// 同时明确：这里只提取业务字段，绝不读取任何 HTTP 头之外的"环境信息"。

import type { UploadInput } from "./service.ts";
import { config } from "./config.ts";

export class BodyTooLargeError extends Error {}

export function assertContentLength(req: Request, maxBytes: number): void {
  const raw = req.headers.get("content-length");
  if (raw === null) return; // chunked 请求由下面的实际读取兜底
  const n = Number(raw);
  if (Number.isFinite(n) && n > maxBytes) {
    throw new BodyTooLargeError("请求体过大。");
  }
}

export interface ParsedForm {
  fields: Record<string, string>;
  files: UploadInput[];
}

/** 解析 multipart 或 urlencoded 表单。文件统一读成 Uint8Array。 */
export async function parseForm(
  req: Request,
  maxTotalBytes: number,
): Promise<ParsedForm> {
  const type = req.headers.get("content-type") ?? "";
  const fields: Record<string, string> = {};
  const files: UploadInput[] = [];

  if (type.includes("application/x-www-form-urlencoded")) {
    const text = await readLimited(req, 64 * 1024);
    for (const [k, v] of new URLSearchParams(text)) fields[k] = v;
    return { fields, files };
  }

  if (!type.includes("multipart/form-data")) {
    throw new BodyTooLargeError("不支持的提交格式。");
  }

  assertContentLength(req, maxTotalBytes);
  const form = await req.formData();

  for (const [key, value] of form) {
    if (typeof value === "string") {
      fields[key] = value;
      continue;
    }
    // File
    if (value.size === 0) continue;
    if (value.size > config.maxAttachmentBytes) {
      throw new BodyTooLargeError(
        `单个附件不得超过 ${
          Math.round(config.maxAttachmentBytes / 1048576)
        } MB。`,
      );
    }
    const buf = new Uint8Array(await value.arrayBuffer());
    files.push({
      filename: value.name, // 仅用于日志之外的类型兜底，不落库
      contentType: value.type,
      bytes: buf,
    });
  }

  return { fields, files };
}

async function readLimited(req: Request, max: number): Promise<string> {
  const reader = req.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel();
      throw new BodyTooLargeError("请求体过大。");
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    merged.set(c, off);
    off += c.length;
  }
  return new TextDecoder().decode(merged);
}

/** 表单里的复选框：只要出现且不为空即视为选中。 */
export function checked(fields: Record<string, string>, name: string): boolean {
  const v = fields[name];
  return v !== undefined && v !== "" && v !== "false" && v !== "0";
}
