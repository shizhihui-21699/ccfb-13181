// 共用 UI 组件（纯服务端渲染，无 JS 依赖）。

import type { ComponentChildren } from "preact";
import {
  CATEGORIES,
  ROLE_LABELS,
  SEVERITIES,
  STATUSES,
} from "../lib/config.ts";
import type { CaseStatus } from "../lib/repo.ts";

export function categoryLabel(v: string): string {
  return CATEGORIES.find((c) => c.value === v)?.label ?? v;
}

export function severityLabel(v: string): string {
  return SEVERITIES.find((s) => s.value === v)?.label ?? v;
}

export function statusLabel(v: string): string {
  return STATUSES.find((s) => s.value === v)?.label ?? v;
}

export function statusDesc(v: string): string {
  return STATUSES.find((s) => s.value === v)?.desc ?? "";
}

export function StatusBadge({ status }: { status: string }) {
  return <span class={`badge ${status}`}>{statusLabel(status)}</span>;
}

export function SeverityBadge({ severity }: { severity: string }) {
  return <span class={`badge sev-${severity}`}>{severityLabel(severity)}</span>;
}

export function PageHeader(
  { title, subtitle, children }: {
    title: string;
    subtitle?: string;
    children?: ComponentChildren;
  },
) {
  return (
    <div style="margin-bottom:20px">
      <h1>{title}</h1>
      {subtitle && <p class="lede">{subtitle}</p>}
      {children}
    </div>
  );
}

export function Field(
  { label, required, hint, children }: {
    label: string;
    required?: boolean;
    hint?: string;
    children: ComponentChildren;
  },
) {
  return (
    <div>
      <label class="field">
        {label}
        {required && <span class="req">*</span>}
      </label>
      {hint && <p class="hint">{hint}</p>}
      {children}
    </div>
  );
}

export function Notice(
  { kind = "info", title, children }: {
    kind?: "info" | "warn" | "danger" | "ok";
    title?: string;
    children?: ComponentChildren;
  },
) {
  return (
    <div
      class={`notice ${kind}`}
      role={kind === "danger" ? "alert" : undefined}
    >
      {title && <strong>{title}</strong>}
      {children}
    </div>
  );
}

export function StaffNav(
  { staff, active }: {
    staff: { role: string; display_name: string };
    active: string;
  },
) {
  const items: [string, string][] = [];
  if (staff.role !== "admin") items.push(["/staff", "案件队列"]);
  if (staff.role === "admin") items.push(["/staff", "概览"]);
  if (staff.role === "lead" || staff.role === "auditor") {
    items.push(["/staff/audit", "审计日志"]);
  }
  if (staff.role === "admin") items.push(["/staff/staff", "账号管理"]);
  if (staff.role === "admin" || staff.role === "auditor") {
    items.push(["/staff/audit", "审计日志"]);
  }
  items.push(["/staff/account", "我的账号"]);

  const uniq = items.filter((v, i, a) =>
    a.findIndex((x) => x[0] === v[0]) === i
  );

  return (
    <nav>
      {uniq.map(([href, label]) => (
        <a href={href} class={active === href ? "on" : ""}>{label}</a>
      ))}
      <form method="post" action="/staff/logout" style="display:inline">
        <button
          type="submit"
          style="background:none;border:0;color:#c9d1d9;padding:6px 10px;font-size:14px"
        >
          退出（{staff.display_name}·{ROLE_LABELS[staff.role] ?? staff.role}）
        </button>
      </form>
    </nav>
  );
}

export function EmptyState(
  { title, children }: { title: string; children?: ComponentChildren },
) {
  return (
    <div class="card" style="text-align:center;padding:44px 20px">
      <h3 style="margin:0 0 6px">{title}</h3>
      <p class="muted">{children}</p>
    </div>
  );
}

export function formatDay(day: string | null | undefined): string {
  return day ?? "—";
}

/** 员工侧精确时间，只给员工看。 */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${
    pad(d.getHours())
  }:${pad(d.getMinutes())}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

export type { CaseStatus };
