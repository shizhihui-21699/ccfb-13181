// 一个极小的前端脚本：为带 data-confirm 的表单加上提交确认，
// 并在"复制凭据"按钮上挂剪贴板逻辑。
//
// 为什么不用内联 onclick：CSP 更严，且 Preact 对字符串事件属性不友好。
// 这段脚本不采集任何数据，不发起网络请求，也不读写 localStorage。

const confirmForms = document.querySelectorAll("form[data-confirm]");
for (const form of confirmForms) {
  form.addEventListener("submit", (e) => {
    const msg = form.getAttribute("data-confirm") || "确定继续？";
    if (!globalThis.confirm(msg)) e.preventDefault();
  });
}

const copyButtons = document.querySelectorAll("[data-copy]");
for (const btn of copyButtons) {
  btn.addEventListener("click", async () => {
    const target = btn.getAttribute("data-copy") || "";
    const original = btn.textContent || "";
    try {
      await navigator.clipboard.writeText(target);
      btn.textContent = "已复制";
    } catch {
      btn.textContent = "请手动选中复制";
    }
    setTimeout(() => {
      btn.textContent = original;
    }, 2500);
  });
}
