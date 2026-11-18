import { define } from "../../utils.ts";
import * as repo from "../../lib/repo.ts";

export const handler = define.handlers({
  POST(ctx) {
    const c = ctx.state.reporter;
    if (!c) return ctx.redirect("/track");
    // 已结案/已处理/已撤回都不能再撤回：前两者已有正式结论，撤回会破坏留痕。
    if (["closed", "resolved", "withdrawn"].includes(c.status)) {
      return ctx.redirect("/case");
    }

    repo.withdrawCase(c.id);
    // 我们不删除内容：审计需要"举报发生过"，且删除会破坏调查组已有的时间线。
    // 但案件立刻退出队列，后续也不会再收到调查组的追问。
    return ctx.redirect("/case?withdrawn=1");
  },
});
