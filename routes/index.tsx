import { define } from "../utils.ts";
import { Notice, PageHeader } from "../components/ui.tsx";
import { promises } from "../lib/config.ts";

export default define.page(function Home() {
  return (
    <>
      <PageHeader
        title="你可以匿名反映问题"
        subtitle="本渠道只收集举报内容本身。系统里没有你的姓名、工号、邮箱、IP 或设备信息——不是“我们承诺不看”，而是“数据库里根本没有这些字段”。"
      />

      <div class="card">
        <h2>它是怎么做到匿名的</h2>
        <ul style="margin:8px 0 0;padding-left:20px;font-size:15px">
          <li>提交时不需要登录，也不收集任何账号信息。</li>
          <li>
            系统不记录 IP 地址、浏览器标识、访问时间（精确到天）、来源页面。
          </li>
          <li>附件上传前会清除拍摄地点、设备型号、文档作者等元数据。</li>
          <li>
            提交成功后只给你一串随机凭据。凭它查看进展、与调查员匿名对话。
            <b>平台管理员也看不到你是谁</b>，因为没有可看的东西。
          </li>
        </ul>
      </div>

      <div class="grid-2">
        <div class="card">
          <h3>会保存什么</h3>
          <ul class="small" style="padding-left:18px;margin:6px 0">
            {promises.collected.map((s) => <li key={s}>{s}</li>)}
          </ul>
        </div>
        <div class="card">
          <h3>绝不收集什么</h3>
          <ul class="small" style="padding-left:18px;margin:6px 0">
            {promises.neverCollected.map((s) => <li key={s}>{s}</li>)}
          </ul>
        </div>
      </div>

      <Notice kind="warn" title="在提交之前，请先确认环境安全">
        <ul>
          <li>
            不要使用公司配发的电脑或公司网络提交，除非你确认没有上网行为审计。
          </li>
          <li>
            本系统不记录
            IP，但你所在网络的路由器、代理服务器可能会。用个人设备与个人网络更稳妥。
          </li>
          <li>提交后请立刻保存凭据，并清除浏览器历史。</li>
        </ul>
      </Notice>

      <div class="btn-row">
        <a class="btn" href="/report">开始提交</a>
        <a class="btn secondary" href="/track">我已提交，查询进展</a>
      </div>

      <p class="muted small" style="margin-top:26px">
        如果你担心自己已经暴露，或情况紧急（人身安全、正在发生的重大违规），请优先联系公司
        已公布的专用举报电话或外部举报渠道，而不是本系统。写给调查组的消息一旦发出，
        就会永久留在案件记录里。
      </p>
    </>
  );
});
