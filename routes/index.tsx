export default function Home() {
  return (
    <main class="page">
      <header class="hero">
        <h1>安心通道</h1>
        <p class="tagline">匿名违规举报平台 —— 技术上无法追溯举报人身份</p>
      </header>

      <section class="card">
        <h2>我们如何保护你的匿名性</h2>
        <ul class="guarantees">
          <li>
            <strong>不记录网络信息</strong>{" "}
            —— 不记录 IP 地址、浏览器指纹、访问日志
          </li>
          <li>
            <strong>不需要任何账号</strong> —— 无需邮箱、手机号、工号,提交即匿名
          </li>
          <li>
            <strong>凭据只有你知道</strong>{" "}
            —— 案件凭据只显示一次,系统中只存它的哈希值
          </li>
          <li>
            <strong>附件自动清理</strong>{" "}
            —— 图片的 EXIF 等元数据在服务器端自动剥离
          </li>
          <li>
            <strong>管理员也看不到</strong>{" "}
            —— 数据库中不存在任何能关联到举报人身份的字段
          </li>
        </ul>
        <p class="muted small">
          进一步建议:使用个人设备和非办公网络访问;不要在举报内容中写下自己的姓名、
          工号或只有少数人知道的细节;提交后妥善保管案件凭据,丢失无法找回。
        </p>
      </section>

      <nav class="actions">
        <a class="btn primary" href="/report">我要举报</a>
        <a class="btn" href="/case">查询案件进展</a>
        <a class="btn subtle" href="/staff/login">工作人员入口</a>
      </nav>
    </main>
  );
}
