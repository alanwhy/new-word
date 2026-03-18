// popup.js

const $ = (id) => document.getElementById(id);

let currentUser = null;
let allWords = [];
let filteredWords = [];
let currentDetailWord = null;

// ─────────────────────────
// 初始化
// ─────────────────────────
async function init() {
  const res = await send({ type: "GET_USER" });
  if (res.success && res.user) {
    currentUser = res.user;
    showMainView();
    loadWords();
  } else {
    showLoginView();
  }
}

function showLoginView() {
  $("login-view").classList.remove("hidden");
  $("main-view").classList.add("hidden");
}

function showMainView() {
  $("login-view").classList.add("hidden");
  $("main-view").classList.remove("hidden");

  // 设置用户信息
  $("user-name").textContent = currentUser.displayName || currentUser.email;
  if (currentUser.photoUrl) {
    $("user-avatar").src = currentUser.photoUrl;
  } else {
    $("user-avatar").src =
      `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUser.displayName || "U")}&background=4f46e5&color=fff&size=64`;
  }
}

// ─────────────────────────
// 登录 / 登出
// ─────────────────────────
$("login-btn").addEventListener("click", async () => {
  const btn = $("login-btn");
  btn.disabled = true;
  btn.textContent = "登录中...";
  $("login-error").classList.add("hidden");

  const res = await send({ type: "LOGIN" });
  if (res.success && res.user) {
    currentUser = res.user;
    showMainView();
    loadWords();
  } else {
    $("login-error").textContent = res.error || "登录失败，请重试";
    $("login-error").classList.remove("hidden");
    btn.disabled = false;
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
      <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
    </svg>使用 Google 账号登录`;
  }
});

$("logout-btn").addEventListener("click", async () => {
  if (!confirm("确认退出登录？")) return;
  await send({ type: "LOGOUT" });
  currentUser = null;
  allWords = [];
  showLoginView();
});

// ─────────────────────────
// 加载生词列表
// ─────────────────────────
async function loadWords() {
  renderWordList(null); // 显示加载状态

  const res = await send({ type: "GET_ALL_WORDS", uid: currentUser.uid });
  if (res.success) {
    allWords = res.words || [];
    $("word-count-header").textContent = `${allWords.length} 个生词`;
    applyFilters();
  } else {
    renderWordList([]);
  }
}

// ─────────────────────────
// 搜索 & 排序
// ─────────────────────────
$("search-input").addEventListener("input", () => {
  const val = $("search-input").value;
  $("clear-search").classList.toggle("hidden", !val);
  applyFilters();
});

$("clear-search").addEventListener("click", () => {
  $("search-input").value = "";
  $("clear-search").classList.add("hidden");
  applyFilters();
});

$("sort-select").addEventListener("change", applyFilters);

function applyFilters() {
  const query = $("search-input").value.trim().toLowerCase();
  const sort = $("sort-select").value;

  filteredWords = allWords.filter(
    (w) => !query || w.word?.includes(query) || w.displayWord?.toLowerCase().includes(query),
  );

  filteredWords.sort((a, b) => {
    if (sort === "count") return (b.count || 0) - (a.count || 0);
    if (sort === "time") return new Date(b.lastCollectedAt || 0) - new Date(a.lastCollectedAt || 0);
    if (sort === "alpha") return (a.word || "").localeCompare(b.word || "");
    return 0;
  });

  renderWordList(filteredWords);
}

// ─────────────────────────
// 渲染列表
// ─────────────────────────
function renderWordList(words) {
  const container = $("word-list");
  const emptyState = $("empty-state");
  const noResult = $("no-result-state");

  emptyState.classList.add("hidden");
  noResult.classList.add("hidden");

  if (words === null) {
    container.innerHTML = `<div class="loading-state"><div class="spinner"></div><span>加载中...</span></div>`;
    return;
  }

  if (allWords.length === 0) {
    container.innerHTML = "";
    emptyState.classList.remove("hidden");
    return;
  }

  if (words.length === 0) {
    container.innerHTML = "";
    noResult.classList.remove("hidden");
    return;
  }

  container.innerHTML = words
    .map((w) => {
      const ctx = getDisplayContext(w);
      return `
      <div class="word-item" data-word="${escapeAttr(w.word)}">
        <div class="word-main">
          <div class="word-text">${escapeHtml(w.displayWord || w.word)}</div>
          ${ctx ? `<div class="word-context">${ctx}</div>` : ""}
        </div>
        <span class="badge-count">×${w.count || 1}</span>
      </div>
    `;
    })
    .join("");

  // 绑定点击事件
  container.querySelectorAll(".word-item").forEach((el) => {
    el.addEventListener("click", () => {
      const word = el.dataset.word;
      const wordData = allWords.find((w) => w.word === word);
      if (wordData) openDetail(wordData);
    });
  });
}

function getDisplayContext(wordData) {
  const contexts = wordData.contexts;
  if (!contexts || contexts.length === 0) return "";
  const last = contexts[contexts.length - 1];
  const text = last.text || "";
  if (!text) return "";
  const query = $("search-input").value.toLowerCase();
  const targetWord = wordData.displayWord || wordData.word;
  // 高亮单词
  const regex = new RegExp(`(${escapeRegex(targetWord)})`, "gi");
  return escapeHtml(text.slice(0, 80)).replace(
    new RegExp(`(${escapeRegex(escapeHtml(targetWord))})`, "gi"),
    "<em>$1</em>",
  );
}

// ─────────────────────────
// 单词详情弹层
// ─────────────────────────
function openDetail(wordData) {
  currentDetailWord = wordData;
  $("detail-word").textContent = wordData.displayWord || wordData.word;
  $("detail-count").textContent = `已收藏 ${wordData.count || 1} 次`;

  const first = wordData.firstCollectedAt ? formatDate(wordData.firstCollectedAt) : "";
  const last = wordData.lastCollectedAt ? formatDate(wordData.lastCollectedAt) : "";
  $("detail-dates").textContent = first ? `首次 ${first}  最近 ${last}` : "";

  const contexts = wordData.contexts || [];
  const targetWord = wordData.displayWord || wordData.word;
  $("detail-contexts").innerHTML =
    contexts
      .slice()
      .reverse()
      .map((ctx) => {
        const text = escapeHtml(ctx.text || "").replace(
          new RegExp(`(${escapeRegex(escapeHtml(targetWord))})`, "gi"),
          "<em>$1</em>",
        );
        const title = escapeHtml(ctx.title || ctx.url || "");
        const href = ctx.url ? escapeAttr(ctx.url) : "";
        return `
      <div class="context-item">
        ${text ? `<div>${text}</div>` : ""}
        ${href ? `<a class="ctx-link" href="${href}" target="_blank" rel="noopener noreferrer">${title || href}</a>` : ""}
        <small style="opacity:0.5">${ctx.time ? formatDate(ctx.time) : ""}</small>
      </div>
    `;
      })
      .join("") || '<div class="context-item" style="color:var(--text-muted)">暂无上下文记录</div>';

  $("word-detail-modal").classList.remove("hidden");
}

$("close-modal").addEventListener("click", closeDetail);
$("word-detail-modal").addEventListener("click", (e) => {
  if (e.target === $("word-detail-modal")) closeDetail();
});
function closeDetail() {
  $("word-detail-modal").classList.add("hidden");
  currentDetailWord = null;
}

$("delete-word-btn").addEventListener("click", async () => {
  if (!currentDetailWord) return;
  if (!confirm(`确认删除「${currentDetailWord.displayWord || currentDetailWord.word}」？`)) return;

  const btn = $("delete-word-btn");
  btn.disabled = true;
  btn.textContent = "删除中...";

  const res = await send({
    type: "DELETE_WORD",
    uid: currentUser.uid,
    word: currentDetailWord.word,
  });

  if (res.success) {
    allWords = allWords.filter((w) => w.word !== currentDetailWord.word);
    $("word-count-header").textContent = `${allWords.length} 个生词`;
    closeDetail();
    applyFilters();
  } else {
    btn.disabled = false;
    btn.textContent = "删除失败，请重试";
    setTimeout(() => {
      btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
        <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
      </svg>从生词本删除`;
    }, 2000);
  }
});

// ─────────────────────────
// 工具函数
// ─────────────────────────
function send(message) {
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

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeAttr(s) {
  return String(s).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

// 启动
init();
