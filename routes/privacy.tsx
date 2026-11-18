import { define } from "../utils.ts";
import { Notice, PageHeader } from "../components/ui.tsx";
import { promises } from "../lib/config.ts";

export default define.page(function PrivacyPage() {
  return (
    <>
      <PageHeader
        title="匿名性与数据说明"
        subtitle="这一页把「我们收集什么、不收集什么、为什么删不掉你的身份信息」讲清楚。"
      />

      <div class="card">
        <h2 style="margin-top:0">一句话总结</h2>
        <p>
          系统<b>
            没有
          </b>存放举报人身份的位置。不是"权限控制得严"，而是数据库表里根本没有姓名、工号、邮箱、IP
          的字段。
          即使平台管理员、数据库管理员、甚至拿到备份的人，也无法从系统里还原出举报人是谁。
        </p>
      </div>

      <div class="grid-2">
        <div class="card">
          <h3 style="margin-top:0">会保存</h3>
          <ul class="small" style="padding-left:18px">
            {promises.collected.map((s) => <li key={s}>{s}</li>)}
          </ul>
        </div>
        <div class="card">
          <h3 style="margin-top:0">不会保存</h3>
          <ul class="small" style="padding-left:18px">
            {promises.neverCollected.map((s) => <li key={s}>{s}</li>)}
          </ul>
        </div>
      </div>

      <h2>可疑信息清单</h2>
      <p class="muted small">
        下面这些信息一旦进入系统，几乎都能单独或组合起来定位到个人。它们会在提交时被丢弃，
        或者在写入数据库之前被处理掉。
      </p>

      <div class="card" style="padding:0">
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>信息</th>
                <th>为什么危险</th>
                <th>本系统的处理</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>IP 地址</td>
                <td>结合 DHCP 日志、VPN 日志即可定位到工位或家庭宽带</td>
                <td>
                  不读取、不写日志、不写入数据库；反向代理侧也应关闭访问日志
                </td>
              </tr>
              <tr>
                <td>精确提交时间</td>
                <td>与门禁、打卡、排班表比对，可在小范围里唯一确定</td>
                <td>只存到"天"；举报人消息同样只到天</td>
              </tr>
              <tr>
                <td>User-Agent / 设备指纹</td>
                <td>设备型号 + 浏览器版本 + 字体等信息可近似唯一</td>
                <td>不记录；页面不加载任何第三方资源，不做指纹采集</td>
              </tr>
              <tr>
                <td>登录账号 / SSO</td>
                <td>直接实名</td>
                <td>举报侧完全无需登录；员工账号体系与案件表物理分离</td>
              </tr>
              <tr>
                <td>附件原始文件名</td>
                <td>常见如「张三-工资条.xlsx」「IMG_20241118_办公室.jpg」</td>
                <td>丢弃，服务端用随机名存储</td>
              </tr>
              <tr>
                <td>照片 EXIF</td>
                <td>GPS 坐标、设备型号、拍摄时间、镜头序列号</td>
                <td>上传前剥除，只保留像素数据</td>
              </tr>
              <tr>
                <td>PDF / Office 元数据</td>
                <td>作者、公司、最后修改人、打印机、内网路径</td>
                <td>清除；Office 格式直接拒收，要求另存为 PDF</td>
              </tr>
              <tr>
                <td>来源页面（Referer）</td>
                <td>若从 OA 或内网系统点过来，会暴露"谁在哪个系统里"</td>
                <td>响应头 no-referrer；页面不引用外部资源</td>
              </tr>
              <tr>
                <td>浏览器本地存储</td>
                <td>共享电脑上的历史、自动填充、下载记录</td>
                <td>不使用 localStorage 存凭据；页面禁缓存；凭据只显示一次</td>
              </tr>
              <tr>
                <td>报文大小与访问模式</td>
                <td>结合网络设备流量记录，可推断"某时段有人提交了较长内容"</td>
                <td>无法完全消除；建议使用个人网络（见下方残余风险）</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <h2>凭据与找回</h2>
      <div class="card">
        <p>
          提交成功后，系统生成一串 25 位随机凭据（125 位熵），数据库里只保存它的
          带密钥哈希。凭据用于：
        </p>
        <ul style="padding-left:20px">
          <li>查看案件状态与调查组的留言；</li>
          <li>补充材料、上传附件；</li>
          <li>在任意时刻撤回举报。</li>
        </ul>
        <p>
          凭据<b>不会</b>与任何员工账号、邮箱、手机号关联，因此<b>
            丢失后无法找回
          </b>。
          这是匿名性的代价，也是它成立的前提。请把它抄在纸上或存进个人密码管理器。
        </p>
      </div>

      <h2>残余风险（必须如实告诉你）</h2>
      <Notice kind="warn" title="本系统解决不了的问题">
        <ul>
          <li>
            <b>
              网络层记录
            </b>：公司网络、VPN、代理服务器的流量日志不在本系统控制范围内。
            使用公司设备或公司网络提交，仍可能被网络侧记录。
          </li>
          <li>
            <b>
              内容自我暴露
            </b>：你在正文里写的细节、照片画面中的工牌/文件/窗外景物，
            都可能指向你。系统只能清理元数据，不能替你判断内容。
          </li>
          <li>
            <b>小范围推断</b>：如果某个科室只有 3 个人，且只有你掌握某个细节，
            "内容本身"就足以让调查人员猜到是谁。这与系统是否记录身份无关。
          </li>
          <li>
            <b>
              调查过程中的问询
            </b>：如果调查需要访谈，访谈对象的选择可能间接暴露举报人。
            合规流程应避免"照着举报原文逐条问被举报人"。
          </li>
        </ul>
      </Notice>

      <h2>调查侧如何防止反查</h2>
      <div class="card">
        <ul style="padding-left:20px">
          <li>
            调查员只能看到分派给自己的案件，且看不到任何举报人字段（因为没有）。
          </li>
          <li>
            平台管理员<b>看不到案件正文</b>，只能管理账号与查看审计日志。
          </li>
          <li>
            所有员工侧操作（查看、分派、留言、下载附件）都写入审计日志，可被审计员复查。
          </li>
          <li>系统不记录员工的 IP / UA，审计日志只记录"谁做了什么"。</li>
          <li>向举报人发消息时，界面会提示"不要索取姓名、工号、联系方式"。</li>
        </ul>
      </div>

      <h2>保留与删除</h2>
      <div class="card">
        <p>
          案件在结案后按公司合规保留期归档；到期后由运维按流程删除（含附件）。
          举报人可以随时撤回，撤回后案件立即退出调查队列，但已收到的内容会保留用于合规审计留痕。
        </p>
        <p class="small muted">
          如果你希望彻底删除自己提交的内容，目前只能通过撤回 +
          联系合规负责人说明。
          由于系统不知道你是谁，无法提供"一键删除我的全部数据"的自助功能。
        </p>
      </div>
    </>
  );
});
