// 一次性凭据交付。
//
// 提交成功后需要把凭据展示给举报人，但凭据绝不能出现在 URL、日志、
// 浏览器历史或 Referer 里。因此：
//   1. 服务端生成一个随机"交付令牌"，只把令牌放进重定向 URL。
//   2. 凭据本身保存在进程内存里，60 秒后自动失效，且读取即销毁。
//   3. 交付页用完后，令牌对应的内容立即消失，刷新不会再显示。
//
// 这不是持久化存储——如果服务重启导致凭据丢失，用户只能重新举报。
// 这是刻意的取舍：凭据多存一秒，就多一分泄露风险。

import { randomToken } from "./crypto.ts";
import type { SubmitResult } from "./service.ts";

interface Entry {
  result: SubmitResult;
  expiresAt: number;
}

const TTL_MS = 60_000;
const MAX_ENTRIES = 1000;
const store = new Map<string, Entry>();

function sweep() {
  const now = Date.now();
  for (const [k, v] of store) {
    if (v.expiresAt <= now) store.delete(k);
  }
  // 防止内存被刷爆：超出上限时丢弃最旧的。
  while (store.size > MAX_ENTRIES) {
    const first = store.keys().next();
    if (first.done) break;
    store.delete(first.value);
  }
}

export function stashCredentialDelivery(result: SubmitResult): string {
  sweep();
  const token = randomToken(24);
  store.set(token, { result, expiresAt: Date.now() + TTL_MS });
  return token;
}

/** 读取并销毁。只允许成功读取一次。 */
export function consumeCredentialDelivery(token: string): SubmitResult | null {
  sweep();
  const entry = store.get(token);
  if (!entry) return null;
  store.delete(token);
  if (entry.expiresAt <= Date.now()) return null;
  return entry.result;
}
