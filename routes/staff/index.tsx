import { define } from "../../utils.ts";
import {
  EmptyState,
  formatDay,
  PageHeader,
  SeverityBadge,
  StatusBadge,
} from "../../components/ui.tsx";
import * as repo from "../../lib/repo.ts";
import { can, staffOrRedirect } from "../../lib/auth.ts";
import { CATEGORIES, STATUSES } from "../../lib/config.ts";

export const handler = define.handlers({
  GET(ctx) {
    const auth = staffOrRedirect(ctx);
    if (auth instanceof Response) return auth;
    const staff = auth;

    if (!can(staff, "view_case")) {
      // admin 不参与案件业务，首页给概览。
      return {
        data: {
          adminView: true,
          staff,
          stats: repo.caseStats(),
          rows: [],
          filters: {},
          staffList: [],
        },
      };
    }

    const params = ctx.url.searchParams;
    const status = (params.get("status") ?? "open") as
      | repo.CaseStatus
      | "open"
      | "all";
    const assignee = staff.role === "investigator"
      ? staff.id
      : (params.get("assignee") ?? "all");
    const category = params.get("category") ?? "";
    const keyword = params.get("q") ?? "";

    const rows = repo.listCases({
      status: status as repo.CaseStatus | "open" | "all",
      assignee,
      category: category || undefined,
      q: keyword || undefined,
    });

    const stats = repo.caseStats();
    const staffList = staff.role === "lead"
      ? repo.listStaff().filter((s) =>
        s.active && (s.role === "investigator" || s.role === "lead")
      )
      : [];

    return {
      data: {
        adminView: false,
        staff,
        stats,
        rows,
        staffList,
        filters: { status, assignee, category, q: keyword },
      },
    };
  },
});

export default define.page<typeof handler>(function QueuePage({ data }) {
  if (data.adminView) {
    return (
      <>
        <PageHeader
          title="概览"
          subtitle="平台管理员负责账号与系统运行，不参与具体案件。"
        />
        <div class="stat-row">
          <div class="stat">
            <div class="n">{data.stats.total}</div>
            <div class="k">案件总数</div>
          </div>
          <div class="stat">
            <div class="n">{data.stats.open}</div>
            <div class="k">未结案</div>
          </div>
          <div class="stat">
            <div class="n">{data.stats.unassigned}</div>
            <div class="k">待分派</div>
          </div>
          <div class="stat">
            <div class="n">{data.stats.awaitingReporter}</div>
            <div class="k">等待举报人</div>
          </div>
        </div>
        <div class="card">
          <h3 style="margin-top:0">管理员可见范围</h3>
          <p class="small muted" style="margin-bottom:0">
            你可以管理员工账号、查看审计日志，但无法查看案件正文、无法给举报人留言。
            这是刻意设计：管理员是「系统钥匙」，不该同时也是「内容钥匙」。
          </p>
        </div>
        <div class="btn-row">
          <a class="btn" href="/staff/staff">账号管理</a>
          <a class="btn secondary" href="/staff/audit">审计日志</a>
        </div>
      </>
    );
  }

  const { filters, staff } = data;

  return (
    <>
      <PageHeader
        title={staff.role === "investigator" ? "我的案件" : "案件队列"}
        subtitle={staff.role === "investigator"
          ? "只显示分派给你的案件。举报人身份在任何环节都不可知。"
          : "按分派状态与案件状态筛选。所有查看与操作都会记入审计日志。"}
      />

      <div class="stat-row">
        <div class="stat">
          <div class="n">{data.stats.open}</div>
          <div class="k">未结案</div>
        </div>
        <div class="stat">
          <div class="n">{data.stats.unassigned}</div>
          <div class="k">待分派</div>
        </div>
        <div class="stat">
          <div class="n">{data.stats.awaitingReporter}</div>
          <div class="k">等待举报人</div>
        </div>
        <div class="stat">
          <div class="n">{data.stats.total}</div>
          <div class="k">全部案件</div>
        </div>
      </div>

      <form class="filters" method="get" action="/staff">
        <div class="f">
          <label for="f-status">状态</label>
          <select id="f-status" name="status">
            <option value="open" selected={filters.status === "open"}>
              未结案
            </option>
            <option value="all" selected={filters.status === "all"}>
              全部
            </option>
            {STATUSES.map((s) => (
              <option value={s.value} selected={filters.status === s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div class="f">
          <label for="f-cat">类别</label>
          <select id="f-cat" name="category">
            <option value="">全部</option>
            {CATEGORIES.map((c) => (
              <option value={c.value} selected={filters.category === c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        {staff.role !== "investigator" && (
          <div class="f">
            <label for="f-assignee">负责人</label>
            <select id="f-assignee" name="assignee">
              <option value="all" selected={filters.assignee === "all"}>
                全部
              </option>
              <option
                value="unassigned"
                selected={filters.assignee === "unassigned"}
              >
                未分派
              </option>
              {data.staffList.map((s) => (
                <option value={s.id} selected={filters.assignee === s.id}>
                  {s.display_name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div class="f" style="flex:1 1 200px">
          <label for="f-q">搜索</label>
          <input
            id="f-q"
            type="text"
            name="q"
            value={filters.q as string}
            placeholder="案件编号或标题"
          />
        </div>
        <button class="btn secondary" type="submit">筛选</button>
      </form>

      {data.rows.length === 0
        ? (
          <EmptyState title="没有符合条件的案件">
            调整筛选条件，或等待新的举报进入队列。
          </EmptyState>
        )
        : (
          <div class="card tight" style="padding:0">
            <div class="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>案件编号</th>
                    <th>标题</th>
                    <th>类别</th>
                    <th>严重度</th>
                    <th>状态</th>
                    <th>负责人</th>
                    <th>提交</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr>
                      <td class="mono small">
                        <a href={`/staff/cases/${r.id}`}>{r.case_number}</a>
                      </td>
                      <td>
                        <a href={`/staff/cases/${r.id}`}>{r.subject}</a>
                      </td>
                      <td class="small">
                        {CATEGORIES.find((c) => c.value === r.category)
                          ?.label ?? r.category}
                      </td>
                      <td>
                        <SeverityBadge severity={r.severity} />
                      </td>
                      <td>
                        <StatusBadge status={r.status} />
                      </td>
                      <td class="small">
                        {r.assignee_name ?? <span class="muted">未分派</span>}
                      </td>
                      <td class="small mono">{formatDay(r.submitted_day)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
    </>
  );
});
