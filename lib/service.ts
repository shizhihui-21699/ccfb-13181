// 举报提交与往来消息的业务逻辑。
//
// 这里是最需要谨慎的地方：提交请求里出现的每一个字段，都要问一句
// "它会不会把举报人钉死？"。因此：
//   - 只读取表单里的正文/类别/严重度/附件，其余一律忽略
//   - 附件读入内存 → 按魔数净化 → 服务端重命名 → 加密落盘
//   - 任何请求头（IP/UA/Cookie/Referer）都不进入数据库
//   - 提交失败时不写"半成品"案件：先净化，再建案，失败则整体回滚

import { config } from "./config.ts";
import * as repo from "./repo.ts";
import { newAttachmentId, newCaseNumber, newCredential } from "./ids.ts";
import { encryptBlob, hashCredential, sha256Hex } from "./crypto.ts";
import {
  describeSanitization,
  SanitizeError,
  sanitizeUpload,
} from "./sanitize.ts";
import { unlinkSync, writeFileSync } from "node:fs";
import { join } from "jsr:@std/path@^1.1.2";
import type { SanitizedFile } from "./sanitize.ts";

export interface UploadInput {
  filename: string;
  contentType: string;
  bytes: Uint8Array;
}

export interface SubmitInput {
  category: string;
  severity: string;
  subject: string;
  body: string;
  uploads: UploadInput[];
}

export interface SubmitResult {
  caseNumber: string;
  credential: string;
  attachmentNotes: string[];
}

export class ValidationError extends Error {}

export function validateSubmit(
  input: SubmitInput,
  allowedCategories: readonly string[],
): void {
  if (!allowedCategories.includes(input.category)) {
    throw new ValidationError("请选择举报类别。");
  }
  if (!["low", "medium", "high"].includes(input.severity)) {
    throw new ValidationError("请选择严重程度。");
  }
  const subject = input.subject.trim();
  if (subject.length < 2 || subject.length > 200) {
    throw new ValidationError("标题需为 2–200 个字符。");
  }
  const body = input.body.trim();
  if (body.length < 20) {
    throw new ValidationError("正文太短，请至少写 20 个字，说明发生了什么。");
  }
  if (body.length > config.maxBodyChars) {
    throw new ValidationError(`正文超过 ${config.maxBodyChars} 字上限。`);
  }
  if (input.uploads.length > config.maxAttachments) {
    throw new ValidationError(`最多上传 ${config.maxAttachments} 个附件。`);
  }
  const total = input.uploads.reduce((n, u) => n + u.bytes.length, 0);
  if (total > config.maxTotalUploadBytes) {
    throw new ValidationError("附件总大小超过上限。");
  }
}

async function sanitizeAll(uploads: UploadInput[]): Promise<SanitizedFile[]> {
  const out: SanitizedFile[] = [];
  for (const up of uploads) {
    if (up.bytes.length === 0) continue;
    if (up.bytes.length > config.maxAttachmentBytes) {
      throw new ValidationError(
        `单个附件不得超过 ${
          Math.round(config.maxAttachmentBytes / 1048576)
        } MB。`,
      );
    }
    try {
      out.push(await sanitizeUpload(up.bytes));
    } catch (err) {
      if (err instanceof SanitizeError) throw new ValidationError(err.message);
      throw err;
    }
  }
  return out;
}

/** 写盘 + 记库。返回写成功的存储名，供失败时清理。 */
function persist(
  caseId: string,
  messageId: string | null,
  files: SanitizedFile[],
): { written: string[]; notes: string[] } {
  const written: string[] = [];
  const notes: string[] = [];
  for (const f of files) {
    const storedName = `${newAttachmentId()}.${f.extension}`;
    writeFileSync(
      join(config.attachmentDir, storedName),
      encryptBlob(f.bytes),
      {
        mode: 0o600,
      },
    );
    written.push(storedName);
    repo.addAttachment({
      caseId,
      messageId,
      direction: "reporter",
      storedName,
      contentType: f.contentType,
      sizeBytes: f.bytes.length,
      sha256: sha256Hex(f.bytes),
    });
    notes.push(describeSanitization(f));
  }
  return { written, notes };
}

/**
 * 提交举报。
 * 调用方拿到结果后必须立刻把凭据交给用户——它不会再有第二次出现的机会。
 */
export async function submitReport(
  input: SubmitInput,
  allowedCategories: readonly string[],
): Promise<SubmitResult> {
  validateSubmit(input, allowedCategories);
  const files = await sanitizeAll(input.uploads);

  const credential = newCredential();
  const caseNumber = newCaseNumber();

  const caseRow = repo.createCase({
    caseNumber,
    credentialHash: hashCredential(credential),
    category: input.category,
    severity: input.severity,
    subject: input.subject.trim(),
    body: input.body.trim(),
  });

  try {
    const { notes } = persist(caseRow.id, null, files);
    return { caseNumber, credential, attachmentNotes: notes };
  } catch (err) {
    // 回滚：删案件（级联删附件记录），并删掉已落盘的文件。
    for (const a of repo.listAttachments(caseRow.id)) {
      removeAttachmentFile(a.stored_name);
    }
    repo.deleteCaseCascade(caseRow.id);
    throw err;
  }
}

/** 举报人补充材料或回复。 */
export async function reporterReply(
  caseId: string,
  body: string,
  uploads: UploadInput[],
): Promise<string[]> {
  const text = body.trim();
  if (text.length === 0 && uploads.every((u) => u.bytes.length === 0)) {
    throw new ValidationError("请填写内容或上传附件。");
  }
  if (text.length > config.maxMessageChars) {
    throw new ValidationError(`内容超过 ${config.maxMessageChars} 字上限。`);
  }
  if (uploads.length > config.maxAttachments) {
    throw new ValidationError(`最多上传 ${config.maxAttachments} 个附件。`);
  }
  const total = uploads.reduce((n, u) => n + u.bytes.length, 0);
  if (total > config.maxTotalUploadBytes) {
    throw new ValidationError("附件总大小超过上限。");
  }

  const files = await sanitizeAll(uploads);
  const messageId = repo.addReporterMessage(
    caseId,
    text || "（仅上传了附件）",
  );
  const { notes } = persist(caseId, messageId, files);
  return notes;
}

export function removeAttachmentFile(storedName: string): void {
  // 存储名由服务端生成（Base32 + 固定扩展名），不含用户输入，无需防穿越。
  try {
    unlinkSync(join(config.attachmentDir, storedName));
  } catch { /* 已不存在 */ }
}
