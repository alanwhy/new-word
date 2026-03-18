// content.js - 注入到所有网页，处理划词收藏

(function () {
  "use strict";

  // 防止重复注入
  if (window.__newWordInjected) return;
  window.__newWordInjected = true;

  let tooltip = null;
  let lastSelection = null;
  let hideTimer = null;

  // ─────────────────────────
  // 创建悬浮收藏按钮
  // ─────────────────────────
  function createTooltip() {
    const el = document.createElement("div");
    el.id = "__new-word-tooltip__";
    el.innerHTML = `
      <button class="nw-btn nw-save-btn" title="收藏到生词本">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
        </svg>
        <span class="nw-btn-text">收藏</span>
      </button>
    `;
    el.addEventListener("mousedown", (e) => e.stopPropagation());
    el.querySelector(".nw-save-btn").addEventListener("click", handleSaveClick);
    document.body.appendChild(el);
    return el;
  }

  function getTooltip() {
    if (!tooltip || !document.body.contains(tooltip)) {
      tooltip = createTooltip();
    }
    return tooltip;
  }

  function showTooltip(x, y, word) {
    clearTimeout(hideTimer);
    const el = getTooltip();
    el.dataset.word = word;

    // 定位：出现在选中文字上方
    el.style.display = "flex";
    el.style.left = `${x}px`;
    el.style.top = `${y - 10}px`;
    el.style.transform = "translate(-50%, -100%)";

    // 重置按钮状态
    const btn = el.querySelector(".nw-save-btn");
    btn.classList.remove("nw-saved", "nw-error", "nw-loading");
    btn.querySelector(".nw-btn-text").textContent = "收藏";
    btn.disabled = false;
  }

  function hideTooltip(delay = 300) {
    hideTimer = setTimeout(() => {
      const el = getTooltip();
      el.style.display = "none";
    }, delay);
  }

  // ─────────────────────────
  // 收藏逻辑
  // ─────────────────────────
  async function handleSaveClick(e) {
    e.preventDefault();
    e.stopPropagation();

    const el = getTooltip();
    const word = el.dataset.word;
    if (!word) return;

    const btn = el.querySelector(".nw-save-btn");
    btn.disabled = true;
    btn.classList.add("nw-loading");
    btn.querySelector(".nw-btn-text").textContent = "...";

    // 先检查是否登录
    const userRes = await sendToBackground({ type: "GET_USER" });
    if (!userRes.success || !userRes.user) {
      btn.classList.remove("nw-loading");
      btn.classList.add("nw-error");
      btn.querySelector(".nw-btn-text").textContent = "请先登录";
      btn.disabled = false;
      setTimeout(() => hideTooltip(1500), 1500);
      return;
    }

    // 获取上下文（选中词所在句子）
    const context = getContextSentence(word);

    try {
      const res = await sendToBackground({
        type: "SAVE_WORD",
        uid: userRes.user.uid,
        word,
        context,
        pageUrl: location.href,
        pageTitle: document.title,
      });

      if (res.success) {
        btn.classList.remove("nw-loading");
        btn.classList.add("nw-saved");
        const count = res.word?.count || 1;
        btn.querySelector(".nw-btn-text").textContent = `已收藏 ×${count}`;
        showSaveNotification(word, count);
        setTimeout(() => hideTooltip(1000), 1200);
      } else {
        throw new Error(res.error);
      }
    } catch (err) {
      btn.classList.remove("nw-loading");
      btn.classList.add("nw-error");
      btn.querySelector(".nw-btn-text").textContent = "失败";
      btn.disabled = false;
      console.error("[新词本]", err);
    }
  }

  /**
   * 提取选中词前后的句子作为上下文
   */
  function getContextSentence(word) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return "";
    try {
      const range = sel.getRangeAt(0);
      const container = range.commonAncestorContainer;
      const text = container.textContent || "";
      const idx = text.toLowerCase().indexOf(word.toLowerCase());
      if (idx === -1) return text.slice(0, 200);
      const start = Math.max(0, idx - 80);
      const end = Math.min(text.length, idx + word.length + 80);
      return text.slice(start, end).trim();
    } catch {
      return "";
    }
  }

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
      <span><b>${escapeHtml(word)}</b> 已收藏，共 ${count} 次</span>
    `;
    document.body.appendChild(notif);
    // 强制 reflow 触发动画
    notif.getBoundingClientRect();
    notif.classList.add("show");
    setTimeout(() => {
      notif.classList.remove("show");
      setTimeout(() => notif.remove(), 400);
    }, 2500);
  }

  function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // ─────────────────────────
  // 监听文字选中
  // ─────────────────────────
  document.addEventListener("mouseup", (e) => {
    // 排除点击 tooltip 本身
    if (e.target.closest && e.target.closest("#__new-word-tooltip__")) return;

    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel?.toString().trim();

      // 只处理英文单词（允许带连字符）
      if (!text || !/^[a-zA-Z]([a-zA-Z'-]*[a-zA-Z])?$/.test(text) || text.length < 2) {
        hideTooltip(200);
        return;
      }

      lastSelection = text;

      // 获取选区位置
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const x = (rect.left + rect.right) / 2 + window.scrollX;
      const y = rect.top + window.scrollY;

      showTooltip(x, y, text);
    }, 10);
  });

  document.addEventListener("mousedown", (e) => {
    if (e.target.closest && e.target.closest("#__new-word-tooltip__")) return;
    hideTooltip(150);
  });

  document.addEventListener("keydown", () => hideTooltip(100));
  document.addEventListener("scroll", () => hideTooltip(100), true);

  // ─────────────────────────
  // 监听 background 消息
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
  // 工具函数
  // ─────────────────────────
  function sendToBackground(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (res) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(res || { success: false, error: "无响应" });
        }
      });
    });
  }
})();
