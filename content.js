// content.js - 注入到所有网页，处理右键菜单收藏后的通知展示

(function () {
  "use strict";

  // 防止重复注入
  if (window.__newWordInjected) return;
  window.__newWordInjected = true;

  // ─────────────────────────
  // 监听 background 消息（右键菜单收藏结果）
  // ─────────────────────────
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "NEED_LOGIN") {
      showSaveNotification("请点击插件图标登录 Google 账号", 0);
    }
    if (message.type === "WORD_SAVED") {
      showSaveNotification(message.word, message.count);
    }
  });

  // ─────────────────────────
  // 保存成功通知
  // ─────────────────────────
  function showSaveNotification(word, count) {
    const notif = document.createElement("div");
    notif.className = "__nw-notification__";
    notif.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" fill="currentColor"/>
      </svg>
      <span>${count > 0 ? `<b>${escapeHtml(word)}</b> 已收藏，共 ${count} 次` : escapeHtml(word)}</span>
    `;
    document.body.appendChild(notif);
    notif.getBoundingClientRect(); // 强制 reflow 触发动画
    notif.classList.add("show");
    setTimeout(() => {
      notif.classList.remove("show");
      setTimeout(() => notif.remove(), 400);
    }, 2500);
  }

  function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
})();
