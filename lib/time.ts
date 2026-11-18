// 时间处理。
//
// 这是匿名性设计中最容易被忽视的一环：
// 精确到秒的提交时间，配合门禁记录、打卡记录、排班表，几乎可以唯一定位到人。
// 因此凡是"举报人产生的时间"，一律降级到"天"。
//
// 调查员自己的操作时间不需要匿名，可以精确到秒。

import { config } from "./config.ts";

/** 只保留到"天"的时间戳，如 "2026-11-18"。按时区偏移分桶。 */
export function dayBucket(
  date = new Date(),
  offsetHours = config.dayTzOffsetHours,
): string {
  const shifted = new Date(date.getTime() + offsetHours * 3600_000);
  return shifted.toISOString().slice(0, 10);
}

/** 员工操作使用的精确时间戳（UTC ISO）。 */
export function preciseNow(): string {
  return new Date().toISOString();
}

/** 距离今天的天数，用于计算案件滞留时间（只按天粒度比较）。 */
export function daysSince(day: string, today = dayBucket()): number {
  const a = Date.parse(`${day}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** 在 day 基础上加 n 天，返回 day 字符串。用于保留期计算。 */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * 举报人触发的动作使用的时间戳：归零到当天零点。
 *
 * 为什么必须这样：案件事件、撤回时间、会话创建时间都写在数据库里。
 * 若保留精确时刻，任何拿到数据库或备份的人，都能把它与门禁记录、
 * 打卡记录、代理日志做时间关联，从而反推出举报人。
 *
 * 归零后同一天内的先后顺序会丢失，这是有意的取舍——
 * 调查流程依赖的是"天"，不是"秒"。
 */
export function reporterStamp(now = new Date()): string {
  return `${dayBucket(now)}T00:00:00.000Z`;
}
