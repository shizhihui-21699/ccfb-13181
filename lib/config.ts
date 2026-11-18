// 运行时配置。所有与匿名性相关的开关都集中在这里，便于审计。
//
// 原则：默认值必须是"更匿名"的那一个。任何会削弱匿名性的选项都必须显式开启。

import { join } from "jsr:@std/path@^1.1.2";

const env = (k: string): string | undefined =>
  Deno.env.get(k)?.trim() || undefined;

export const config = {
  /** 数据目录。权限 0700，数据库文件 0600。 */
  dataDir: env("WHISTLE_DATA_DIR") ?? join(Deno.cwd(), "data"),
  get dbPath(): string {
    return env("WHISTLE_DB") ?? join(this.dataDir, "whistle.sqlite");
  },
  get attachmentDir(): string {
    return join(this.dataDir, "attachments");
  },
  /** 用于生成绝对链接（如部署在外网时的说明页）。 */
  baseUrl: env("WHISTLE_BASE_URL") ?? "http://localhost:8000",
  /** 反代已终止 TLS 时设为 "true"，用于 Secure Cookie 与 HSTS。 */
  get secure(): boolean {
    return env("WHISTLE_SECURE") === "true";
  },
  /** 反向代理可信时才开。伪造 X-Forwarded-* 会污染审计日志。 */
  get trustProxy(): boolean {
    return env("WHISTLE_TRUST_PROXY") === "true";
  },
  /** 把"天"归到哪个时区。只影响按天降级的时间戳。 */
  get dayTzOffsetHours(): number {
    return Number(env("WHISTLE_DAY_TZ_OFFSET_HOURS") ?? "8");
  },
  /** 员工登录会话有效期（小时）。 */
  get staffSessionHours(): number {
    return Number(env("WHISTLE_STAFF_SESSION_HOURS") ?? "12");
  },
  /** 单次举报正文上限（字符）。 */
  get maxBodyChars(): number {
    return Number(env("WHISTLE_MAX_BODY_CHARS") ?? "20000");
  },
  get maxMessageChars(): number {
    return Number(env("WHISTLE_MAX_MESSAGE_CHARS") ?? "10000");
  },
  /** 单个附件上限（字节）。默认 8 MiB。 */
  get maxAttachmentBytes(): number {
    return Number(
      env("WHISTLE_MAX_ATTACHMENT_BYTES") ?? String(8 * 1024 * 1024),
    );
  },
  /** 单次提交附件总上限。 */
  get maxTotalUploadBytes(): number {
    return Number(
      env("WHISTLE_MAX_TOTAL_UPLOAD_BYTES") ?? String(24 * 1024 * 1024),
    );
  },
  get maxAttachments(): number {
    return Number(env("WHISTLE_MAX_ATTACHMENTS") ?? "5");
  },
  /** 已结案案件的保留天数。0 表示不自动清理。 */
  get retentionDays(): number {
    return Number(env("WHISTLE_RETENTION_DAYS") ?? "0");
  },
  /** 首次启动时若未提供 pepper，会自动生成并写入 dataDir。 */
  get pepperPath(): string {
    return env("WHISTLE_PEPPER_FILE") ?? join(this.dataDir, "pepper.key");
  },
} as const;

export const CATEGORIES = [
  { value: "corruption", label: "腐败、贿赂、回扣" },
  { value: "fraud", label: "财务舞弊、造假" },
  { value: "conflict", label: "利益冲突、关联交易" },
  { value: "harassment", label: "骚扰、歧视、霸凌" },
  { value: "safety", label: "安全、环保、合规隐患" },
  { value: "privacy", label: "数据与隐私滥用" },
  { value: "abuse", label: "滥用职权、打击报复" },
  { value: "other", label: "其他" },
] as const;

export const SEVERITIES = [
  { value: "low", label: "一般" },
  { value: "medium", label: "重要" },
  { value: "high", label: "紧急" },
] as const;

export const STATUSES = [
  {
    value: "submitted",
    label: "已收到",
    desc: "举报已进入受理队列，等待合规人员分派。",
  },
  {
    value: "triage",
    label: "初核中",
    desc: "合规人员正在评估是否需要正式调查。",
  },
  {
    value: "investigating",
    label: "调查中",
    desc: "已立案调查，调查人员可能会联系你补充材料。",
  },
  {
    value: "awaiting_reporter",
    label: "等待你补充",
    desc: "调查人员向你提出了问题，请尽快回复。",
  },
  {
    value: "resolved",
    label: "已处理",
    desc: "调查结论已作出，案件进入归档流程。",
  },
  { value: "closed", label: "已结案", desc: "案件已归档。" },
  { value: "withdrawn", label: "已撤回", desc: "案件已按你的要求撤回。" },
] as const;

export type StatusValue = typeof STATUSES[number]["value"];

export const ROLE_LABELS: Record<string, string> = {
  investigator: "调查员",
  lead: "合规负责人",
  auditor: "审计员",
  admin: "平台管理员",
};

/** 便于在页面上展示的文案，集中维护，避免各处承诺不一致。 */
export const promises = {
  collected: [
    "举报正文、你主动选择的类别与严重程度",
    "你选择上传的附件（上传前会清除元数据并重命名）",
    "案件编号、状态与往来消息（时间只精确到天）",
  ],
  neverCollected: [
    "姓名、工号、邮箱、电话号码、部门",
    "IP 地址、User-Agent、Cookie、设备指纹",
    "公司账号、单点登录状态",
    "附件的原始文件名、拍摄地点、设备型号等元数据",
  ],
} as const;
