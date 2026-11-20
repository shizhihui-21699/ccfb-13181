import { Handlers, PageProps } from "$fresh/server.ts";
import {
  CaseStatus,
  listCases,
  StaffUser,
  STATUS_FLOW,
  STATUS_LABELS,
  WhistleCase,
} from "../../lib/db.ts";

interface Data {
  user: StaffUser;
  cases: WhistleCase[];
  filter: string;
}

export const handler: Handlers<Data> = {
  async GET(req, ctx) {
    const user = ctx.state.user as StaffUser;
    const url = new URL(req.url);
    const filter = url.searchParams.get("f") ?? "all";

    let cases: WhistleCase[];
    if (filter === "mine") {
      cases = await listCases({ assignee: user.username });
    } else if ((STATUS_FLOW as string[]).includes(filter)) {
      cases = await listCases({ status: filter as CaseStatus });
    } else {
      cases = await listCases();
    }
    return ctx.render({ user, cases, filter });
  },
};

const FILTERS: [string, string][] = [
  ["all", "全部"],
  ["mine", "我负责的"],
  ...STATUS_FLOW.map((s): [string, string] => [s, STATUS_LABELS[s]]),
];

export default function StaffHome({ data }: PageProps<Data>) {
  const { user, cases, filter } = data;
  return (
    <main class="page wide">
      <header class="bar">
        <h1>案件列表</h1>
        <p class="muted">
          {user.displayName}({user.role === "admin" ? "管理员" : "调查员"}) ·
          {" "}
          <a href="/staff/logout">退出登录</a>
        </p>
      </header>

      <nav class="tabs">
        {FILTERS.map(([key, label]) => (
          <a
            href={`/staff?f=${key}`}
            class={filter === key ? "tab active" : "tab"}
          >
            {label}
          </a>
        ))}
      </nav>

      {cases.length === 0
        ? <p class="muted">暂无案件。</p>
        : (
          <table class="case-table">
            <thead>
              <tr>
                <th>案件编号</th>
                <th>标题</th>
                <th>类别</th>
                <th>状态</th>
                <th>提交日期</th>
                <th>负责人</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr>
                  <td>
                    <a href={`/staff/cases/${c.number}`}>
                      <code>{c.number}</code>
                    </a>
                  </td>
                  <td>{c.title}</td>
                  <td>{c.category}</td>
                  <td>
                    <span class={`status status-${c.status}`}>
                      {STATUS_LABELS[c.status]}
                    </span>
                  </td>
                  <td>{c.day}</td>
                  <td>{c.assignee ?? <span class="muted">未分派</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

      <p class="muted small">
        说明:系统中不存在举报人身份相关的任何字段,包括本管理端。
        与举报人的沟通请在案件详情页内进行,不要试图通过其他渠道追查举报人身份。
      </p>
    </main>
  );
}
