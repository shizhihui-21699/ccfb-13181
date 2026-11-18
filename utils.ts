import { createDefine } from "fresh";

// 所有中间件与路由共享的 ctx.state 类型。
export interface State {
  /** 当前员工（员工侧页面用）。匿名举报侧永远为 null。 */
  staff: import("./lib/repo.ts").StaffRow | null;
  /** 当前举报人会话对应的案件。员工侧永远为 null。 */
  reporter: import("./lib/repo.ts").CaseRow | null;
}

export const define = createDefine<State>();
