import { define } from "../utils.ts";
import { StaffNav } from "../components/ui.tsx";

export default define.page(function App({ Component, state, url }) {
  const staff = state.staff;
  const path = url.pathname;
  const isStaff = path.startsWith("/staff");
  const active = path;

  return (
    <html lang="zh-CN">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="robots" content="noindex, nofollow, noarchive" />
        <meta name="referrer" content="no-referrer" />
        <title>内部举报渠道</title>
        <link rel="stylesheet" href="/styles.css" />
        <script src="/app.js" defer></script>
        <link rel="icon" href="data:," />
      </head>
      <body>
        <a class="skip" href="#main">跳到正文</a>
        <header class="site">
          <div class="inner">
            <a class="brand" href={isStaff && staff ? "/staff" : "/"}>
              内部举报渠道
              <small>
                {isStaff ? "调查工作台" : "匿名 · 加密 · 可追踪进展"}
              </small>
            </a>
            {isStaff && staff
              ? <StaffNav staff={staff} active={active} />
              : (
                <nav>
                  {state.reporter
                    ? (
                      <>
                        <a
                          href="/case"
                          class={path.startsWith("/case") ? "on" : ""}
                        >
                          我的案件
                        </a>
                        <a href="/track" class={path === "/track" ? "on" : ""}>
                          切换案件
                        </a>
                      </>
                    )
                    : (
                      <>
                        <a href="/" class={path === "/" ? "on" : ""}>首页</a>
                        <a
                          href="/report"
                          class={path === "/report" ? "on" : ""}
                        >
                          提交举报
                        </a>
                        <a href="/track" class={path === "/track" ? "on" : ""}>
                          查询进展
                        </a>
                      </>
                    )}
                  <a href="/privacy" class={path === "/privacy" ? "on" : ""}>
                    隐私说明
                  </a>
                </nav>
              )}
          </div>
        </header>
        <main id="main" class={isStaff ? "wrap wrap-wide" : "wrap"}>
          <Component />
        </main>
        <footer class="site">
          本系统不记录举报人的任何身份信息。请妥善保管你的案件凭据——丢失后无法找回。
        </footer>
      </body>
    </html>
  );
});
