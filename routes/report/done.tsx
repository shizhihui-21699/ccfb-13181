import { define } from "../../utils.ts";
import { Notice, PageHeader } from "../../components/ui.tsx";
import { consumeCredentialDelivery } from "../../lib/delivery.ts";
import { formatCredential } from "../../lib/ids.ts";

export const handler = define.handlers({
  GET(ctx) {
    const token = ctx.url.searchParams.get("t") ?? "";
    const result = token ? consumeCredentialDelivery(token) : null;
    if (!result) return ctx.redirect("/track?expired=1");
    return { data: result };
  },
});

export default define.page<typeof handler>(function DonePage({ data }) {
  const formatted = formatCredential(data.credential);
  return (
    <>
      <PageHeader
        title="举报已提交"
        subtitle="请立刻保存下面的信息。它们只显示这一次，之后无法找回。"
      />

      <div class="card">
        <h2 style="margin-top:0">你的案件凭据</h2>
        <p class="muted small">
          这是你之后查看进展、回复调查人员的唯一凭据。系统没有你的任何身份信息，因此
          <b>无法为你找回凭据</b>。
        </p>
        <div class="credential-box">
          <div class="label">案件编号（可口头告知，不含身份信息）</div>
          <div class="value">{data.caseNumber}</div>
          <div class="label" style="margin-top:14px">
            案件凭据（只有你知道，务必保密）
          </div>
          <div class="value">{formatted}</div>
        </div>

        <div class="btn-row">
          <button
            class="btn"
            type="button"
            data-copy={data.caseNumber + "\n" + formatted}
          >
            复制编号与凭据
          </button>
          <a class="btn secondary" href="/track">前往查询进展</a>
        </div>

        {data.attachmentNotes.length > 0 && (
          <>
            <h3>附件处理结果</h3>
            <ul class="small" style="padding-left:18px">
              {data.attachmentNotes.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          </>
        )}
      </div>

      <Notice kind="warn" title="现在请做三件事">
        <ul>
          <li>
            把凭据抄在纸上或存进个人密码管理器。不要存进公司邮箱、内部网盘、工作群。
          </li>
          <li>不要截图发到任何工作设备上。</li>
          <li>
            关闭本页面，并清除浏览器历史（凭据只显示这一次，刷新不会重新出现）。
          </li>
        </ul>
      </Notice>

      <Notice kind="info" title="接下来会发生什么">
        <ul>
          <li>合规人员会在工作日受理并分派。你随时可以用凭据查询状态。</li>
          <li>
            如果调查人员需要补充材料，会给你的案件留一条消息，状态会变成「等待你补充」。
          </li>
          <li>调查人员不知道你是谁，只能通过这个案件的留言板与你联系。</li>
        </ul>
      </Notice>
    </>
  );
});
