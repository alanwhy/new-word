// popup.js

const $ = (id) => document.getElementById(id);

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 250;
const LOGIN_BUTTON_HTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">
  <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
  <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
  <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
  <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
</svg>使用 Google 账号登录`;

let currentUser = null;
let allWords = [];
let filteredWords = [];
let searchResults = [];
let currentDetailWord = null;
let currentPage = 1;
let hasNextPage = false;
let isSearchMode = false;
let searchDebounceTimer = null;
let wordRequestSeq = 0;

const pageCache = new Map();
const pageTokenCache = new Map();
let fullWordCache = {
  sort: "",
  words: [],
  loadingPromise: null,
};

// ─────────────────────────
// 主题切换
// ─────────────────────────
async function initTheme() {
  const stored = await new Promise((resolve) => chrome.storage.sync.get("theme", resolve));
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = stored.theme || (systemDark ? "dark" : "light");
  applyTheme(theme, false);
}

function applyTheme(theme, save = true) {
  document.documentElement.setAttribute("data-theme", theme);
  const moonIcon = $("theme-icon-moon");
  const sunIcon = $("theme-icon-sun");
  if (theme === "dark") {
    // 当前深色，点击可切换到浅色，显示太阳图标
    moonIcon?.classList.add("hidden");
    sunIcon?.classList.remove("hidden");
    $("theme-btn").title = "切换浅色模式";
  } else {
    // 当前浅色，点击可切换到深色，显示月亮图标
    moonIcon?.classList.remove("hidden");
    sunIcon?.classList.add("hidden");
    $("theme-btn").title = "切换深色模式";
  }
  if (save) chrome.storage.sync.set({ theme });
}

$("theme-btn").addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  applyTheme(current === "dark" ? "light" : "dark");
});

// ─────────────────────────
// 刷新当前页
// ─────────────────────────
$("refresh-btn").addEventListener("click", async () => {
  const btn = $("refresh-btn");
  if (btn.disabled) return;
  btn.disabled = true;
  btn.classList.add("spinning");
  try {
    await loadActiveView({ forceRefresh: true });
  } finally {
    btn.disabled = false;
    btn.classList.remove("spinning");
  }
});

// ─────────────────────────
// 导出 CSV
// ─────────────────────────
$("export-btn").addEventListener("click", async () => {
  await exportToCSV();
});

async function exportToCSV() {
  let wordsToExport = [];
  try {
    wordsToExport = await ensureAllWordsForCurrentSort();
  } catch (error) {
    alert(getFriendlyErrorMessage(error?.message || error, "loadWords"));
    return;
  }

  if (wordsToExport.length === 0) {
    alert("当前没有生词可以导出");
    return;
  }
  const headers = ["单词", "次数", "首次收藏", "最近收藏", "翻译摘要"];
  const rows = wordsToExport.map((w) => {
    const preview = getTranslationPreview(w);
    return [
      w.displayWord || w.word,
      w.count || 1,
      w.firstCollectedAt ? formatDate(w.firstCollectedAt) : "",
      w.lastCollectedAt ? formatDate(w.lastCollectedAt) : "",
      preview,
    ]
      .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
      .join(",");
  });
  const csv = "\ufeff" + [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `新词本-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─────────────────────────
// 初始化
// ─────────────────────────
async function init() {
  await initTheme();
  const res = await send({ type: "GET_USER" });
  if (res.success && res.user) {
    currentUser = res.user;
    showMainView();
    await loadActiveView({ resetPage: true });
  } else {
    showLoginView();
  }
}

function showLoginView() {
  resetLoginButton();
  $("login-error").classList.add("hidden");
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
    invalidateWordCaches();
    await loadActiveView({ resetPage: true, forceRefresh: true });
  } else {
    showLoginError(getFriendlyErrorMessage(res.error, "login"));
    resetLoginButton();
  }
});

$("logout-btn").addEventListener("click", async () => {
  if (!confirm("确认退出登录？")) return;
  await send({ type: "LOGOUT" });
  currentUser = null;
  allWords = [];
  filteredWords = [];
  searchResults = [];
  invalidateWordCaches();
  showLoginView();
});

// ─────────────────────────
// 加载生词列表
// ─────────────────────────
async function loadActiveView(options = {}) {
  const { resetPage = false, forceRefresh = false } = options;
  if (!currentUser) return;

  if (resetPage) currentPage = 1;

  const query = getCurrentQuery();
  if (query) {
    await loadSearchResults(currentPage, { forceRefresh });
    return;
  }

  await loadWordsPage(currentPage, { forceRefresh });
}

// ─────────────────────────
// 搜索 & 排序
// ─────────────────────────
$("search-input").addEventListener("input", () => {
  const val = $("search-input").value;
  $("clear-search").classList.toggle("hidden", !val);
  scheduleSearch();
});

$("clear-search").addEventListener("click", () => {
  clearTimeout(searchDebounceTimer);
  $("search-input").value = "";
  $("clear-search").classList.add("hidden");
  loadActiveView({ resetPage: true });
});

$("sort-select").addEventListener("change", async () => {
  fullWordCache = { sort: "", words: [], loadingPromise: null };
  await loadActiveView({ resetPage: true });
});

$("retry-load-btn").addEventListener("click", async () => {
  await loadActiveView({ forceRefresh: true });
});

$("prev-page-btn").addEventListener("click", async () => {
  if (currentPage <= 1) return;
  if (isSearchMode) {
    renderSearchPage(currentPage - 1);
    return;
  }
  await loadWordsPage(currentPage - 1);
});

$("next-page-btn").addEventListener("click", async () => {
  if (isSearchMode) {
    const totalPages = Math.max(1, Math.ceil(searchResults.length / PAGE_SIZE));
    if (currentPage >= totalPages) return;
    renderSearchPage(currentPage + 1);
    return;
  }
  if (!hasNextPage) return;
  await loadWordsPage(currentPage + 1);
});

function scheduleSearch() {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = window.setTimeout(() => {
    loadActiveView({ resetPage: true });
  }, SEARCH_DEBOUNCE_MS);
}

async function loadWordsPage(page = 1, options = {}) {
  const { forceRefresh = false } = options;
  const requestId = ++wordRequestSeq;
  const sort = getCurrentSort();
  const safePage = Math.max(1, page);
  const cacheKey = `${sort}:${safePage}`;
  const tokenKey = `${sort}:${safePage}`;

  isSearchMode = false;
  searchResults = [];

  if (safePage === 1 && !pageTokenCache.has(tokenKey)) {
    pageTokenCache.set(tokenKey, "");
  }

  if (!forceRefresh && pageCache.has(cacheKey)) {
    const cached = pageCache.get(cacheKey);
    currentPage = safePage;
    allWords = cached.words;
    filteredWords = cached.words;
    hasNextPage = cached.hasNextPage;
    renderWordList(filteredWords);
    updateWordCountHeader();
    updatePaginationControls();
    return;
  }

  renderWordList(null, "正在加载词库...");

  const pageToken = pageTokenCache.get(tokenKey) || "";

  const res = await send({
    type: "GET_WORDS_PAGE",
    uid: currentUser.uid,
    pageToken,
    pageSize: PAGE_SIZE,
    sort,
  });

  if (requestId !== wordRequestSeq) return;

  if (!res.success) {
    allWords = [];
    filteredWords = [];
    hasNextPage = false;
    renderListError(getFriendlyErrorMessage(res.error, "loadWords"));
    updateWordCountHeader();
    return;
  }

  currentPage = safePage;
  allWords = res.words || [];
  filteredWords = allWords;
  hasNextPage = Boolean(res.hasNextPage);
  pageCache.set(cacheKey, { words: allWords, hasNextPage });

  if (res.nextPageToken) {
    pageTokenCache.set(`${sort}:${safePage + 1}`, res.nextPageToken);
  } else {
    pageTokenCache.delete(`${sort}:${safePage + 1}`);
  }

  renderWordList(filteredWords);
  updateWordCountHeader();
  updatePaginationControls();
}

async function loadSearchResults(page = 1, options = {}) {
  const { forceRefresh = false } = options;
  const requestId = ++wordRequestSeq;
  const query = getCurrentQuery();

  isSearchMode = true;
  renderWordList(null, "正在搜索...");

  try {
    const words = await ensureAllWordsForCurrentSort({ forceRefresh });
    if (requestId !== wordRequestSeq) return;

    searchResults = words.filter((w) => w.word?.includes(query) || w.displayWord?.toLowerCase().includes(query));
    renderSearchPage(page);
  } catch (error) {
    if (requestId !== wordRequestSeq) return;
    allWords = [];
    filteredWords = [];
    searchResults = [];
    hasNextPage = false;
    renderListError(getFriendlyErrorMessage(error?.message || error, "loadWords"));
    updateWordCountHeader();
  }
}

function renderSearchPage(page = 1) {
  const totalPages = Math.max(1, Math.ceil(searchResults.length / PAGE_SIZE));
  currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const end = start + PAGE_SIZE;

  allWords = searchResults.slice(start, end);
  filteredWords = allWords;
  hasNextPage = currentPage < totalPages;
  renderWordList(filteredWords);
  updateWordCountHeader();
  updatePaginationControls();
}

async function ensureAllWordsForCurrentSort(options = {}) {
  const { forceRefresh = false } = options;
  const sort = getCurrentSort();

  if (!forceRefresh && fullWordCache.sort === sort && fullWordCache.words.length > 0) {
    return fullWordCache.words;
  }

  if (!forceRefresh && fullWordCache.sort === sort && fullWordCache.loadingPromise) {
    return fullWordCache.loadingPromise;
  }

  const loadingPromise = (async () => {
    const words = [];
    let pageToken = "";

    while (true) {
      const res = await send({
        type: "GET_WORDS_PAGE",
        uid: currentUser.uid,
        pageToken,
        pageSize: PAGE_SIZE,
        sort,
      });

      if (!res.success) {
        throw new Error(res.error || "获取生词列表失败");
      }

      words.push(...(res.words || []));
      if (!res.hasNextPage) break;
      pageToken = res.nextPageToken || "";
      if (!pageToken) break;
    }

    return words;
  })();

  fullWordCache = {
    sort,
    words: [],
    loadingPromise,
  };

  try {
    const words = await loadingPromise;
    fullWordCache = {
      sort,
      words,
      loadingPromise: null,
    };
    return words;
  } catch (error) {
    fullWordCache = {
      sort: "",
      words: [],
      loadingPromise: null,
    };
    throw error;
  }
}

// ─────────────────────────
// 渲染列表
// ─────────────────────────
function renderWordList(words, loadingText = "加载中...") {
  const container = $("word-list");
  const emptyState = $("empty-state");
  const noResult = $("no-result-state");
  const listError = $("list-error-state");

  emptyState.classList.add("hidden");
  noResult.classList.add("hidden");
  listError.classList.add("hidden");

  if (words === null) {
    container.innerHTML = `<div class="loading-state"><div class="spinner"></div><span>${escapeHtml(loadingText)}</span></div>`;
    $("pagination-bar").classList.add("hidden");
    return;
  }

  if (!isSearchMode && currentPage === 1 && words.length === 0) {
    container.innerHTML = "";
    emptyState.classList.remove("hidden");
    $("pagination-bar").classList.add("hidden");
    return;
  }

  if (words.length === 0) {
    container.innerHTML = "";
    noResult.classList.remove("hidden");
    $("pagination-bar").classList.add("hidden");
    return;
  }

  container.innerHTML = words
    .map((w) => {
      // 脏数据兜底：word/displayWord 缺失时用文档 ID(_id)
      const wordKey = w.word || w._id || "";
      const displayWord = w.displayWord || w.word || w._id || "(未知)";
      const ctx = getDisplayContext(w);
      const translationPreview = getTranslationPreview(w);
      return `
      <div class="word-item" data-word="${escapeAttr(wordKey)}">
        <div class="word-main">
          <div class="word-text">${escapeHtml(displayWord)}</div>
          ${translationPreview ? `<div class="word-translation">${translationPreview}</div>` : ""}
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
      const wordData = allWords.find((w) => (w.word || w._id) === word);
      if (wordData) openDetail(wordData);
    });
  });
}

function renderListError(message) {
  $("word-list").innerHTML = "";
  $("empty-state").classList.add("hidden");
  $("no-result-state").classList.add("hidden");
  $("list-error-text").textContent = message;
  $("list-error-state").classList.remove("hidden");
  $("pagination-bar").classList.add("hidden");
}

function updatePaginationControls() {
  const paginationBar = $("pagination-bar");
  const prevBtn = $("prev-page-btn");
  const nextBtn = $("next-page-btn");
  const info = $("pagination-info");

  if (
    (!isSearchMode && currentPage === 1 && allWords.length === 0) ||
    $("list-error-state").classList.contains("hidden") === false
  ) {
    paginationBar.classList.add("hidden");
    return;
  }

  if (isSearchMode) {
    const totalPages = Math.max(1, Math.ceil(searchResults.length / PAGE_SIZE));
    if (searchResults.length === 0) {
      paginationBar.classList.add("hidden");
      return;
    }
    prevBtn.disabled = currentPage <= 1;
    nextBtn.disabled = currentPage >= totalPages;
    info.textContent = `第 ${currentPage} / ${totalPages} 页 · 每页 ${PAGE_SIZE} 条`;
    paginationBar.classList.remove("hidden");
    return;
  }

  prevBtn.disabled = currentPage <= 1;
  nextBtn.disabled = !hasNextPage;
  info.textContent = `第 ${currentPage} 页 · 每页 ${PAGE_SIZE} 条`;
  paginationBar.classList.remove("hidden");
}

function updateWordCountHeader() {
  if (isSearchMode) {
    if (searchResults.length === 0) {
      $("word-count-header").textContent = "未找到匹配结果";
      return;
    }
    const totalPages = Math.max(1, Math.ceil(searchResults.length / PAGE_SIZE));
    $("word-count-header").textContent = `匹配 ${searchResults.length} 条 · 第 ${currentPage}/${totalPages} 页`;
    return;
  }

  if (currentPage === 1 && allWords.length === 0) {
    $("word-count-header").textContent = "0 个生词";
    return;
  }

  const suffix = hasNextPage ? " · 还有更多" : "";
  $("word-count-header").textContent = `第 ${currentPage} 页 · ${allWords.length} 条${suffix}`;
}

/**
 * 生成单词列表中的翻译预览文字（如 "名词 · 例子；说明"）
 */
function getTranslationPreview(wordData) {
  const translations = wordData.translations;
  if (!translations || translations.length === 0) return "";
  const first = translations[0];
  if (!first || !first.definitions || first.definitions.length === 0) return "";
  const posLabel = first.posZh || first.pos || "";
  const defs = first.definitions
    .slice(0, 2)
    .map((d) => d.zh || "")
    .filter(Boolean)
    .join("；");
  if (!defs) return "";
  return `${escapeHtml(posLabel)} · ${escapeHtml(defs)}`;
}

function getDisplayContext(wordData) {
  const contexts = wordData.contexts;
  if (!contexts || contexts.length === 0) return "";
  const last = contexts[contexts.length - 1];
  const text = last.text || "";
  if (!text) return "";
  const targetWord = wordData.displayWord || wordData.word || wordData._id || "";
  if (!targetWord) return escapeHtml(text.slice(0, 80));
  // 高亮单词
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
  const wordKey = wordData.word || wordData._id || "";
  $("detail-word").textContent = wordData.displayWord || wordData.word || wordData._id || "(未知)";
  $("detail-count").textContent = `已收藏 ${wordData.count || 1} 次`;

  const first = wordData.firstCollectedAt ? formatDate(wordData.firstCollectedAt) : "";
  const last = wordData.lastCollectedAt ? formatDate(wordData.lastCollectedAt) : "";
  $("detail-dates").textContent = first ? `首次 ${first}  最近 ${last}` : "";

  // 渲染翻译区域
  renderTranslations(wordData);

  const contexts = wordData.contexts || [];
  const targetWord = wordData.displayWord || wordData.word || wordData._id || "";
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

// ─────────────────────────
// 渲染翻译区域
// ─────────────────────────
function renderTranslations(wordData) {
  const el = $("detail-translations");
  const hasTranslations = Array.isArray(wordData.translations) && wordData.translations.length > 0;
  const hasContextTrans = !!wordData.contextTranslation;

  if (!hasTranslations && !hasContextTrans) {
    // 无翻译数据：显示「获取翻译」按钮
    el.innerHTML = `<button class="btn btn-fetch-translate" id="fetch-translate-btn">
      <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
      </svg>
      获取中文翻译
    </button>`;
    document.getElementById("fetch-translate-btn")?.addEventListener("click", async () => {
      const btn = document.getElementById("fetch-translate-btn");
      btn.disabled = true;
      btn.innerHTML = `<div class="spinner" style="width:13px;height:13px;border-width:2px"></div>翻译中...`;
      const ctx = wordData.contexts?.[wordData.contexts.length - 1]?.text || "";
      const res = await send({
        type: "TRANSLATE_WORD",
        uid: currentUser.uid,
        word: wordData.word,
        context: ctx,
      });
      if (res.success) {
        wordData.contextTranslation = res.contextTranslation;
        wordData.translations = res.translations;
        wordData.synonyms = res.synonyms || [];
        wordData.antonyms = res.antonyms || [];

        allWords = allWords.map((w) => (w.word === wordData.word ? { ...w, ...wordData } : w));
        filteredWords = allWords;

        if (fullWordCache.words.length > 0) {
          fullWordCache.words = fullWordCache.words.map((w) => (w.word === wordData.word ? { ...w, ...wordData } : w));
        }

        for (const [cacheKey, cacheValue] of pageCache.entries()) {
          pageCache.set(cacheKey, {
            ...cacheValue,
            words: cacheValue.words.map((w) => (w.word === wordData.word ? { ...w, ...wordData } : w)),
          });
        }

        renderTranslations(wordData);
        renderWordList(filteredWords);
        updateWordCountHeader();
        updatePaginationControls();
      } else {
        btn.disabled = false;
        btn.textContent = "获取失败，点击重试";
      }
    });
    return;
  }

  let html = "";

  // 各词性释义（字典式排版）
  const translations = wordData.translations || [];
  if (translations.length > 0) {
    html += `<div class="translation-entries">`;
    for (const entry of translations) {
      const posLabel = escapeHtml(entry.posZh || entry.pos || "");
      html += `<div class="translation-entry">
        <span class="pos-badge">${posLabel}</span>
        <ul class="definition-list">`;
      for (const def of entry.definitions || []) {
        const zh = escapeHtml(def.zh || "");
        const en = escapeHtml(def.en || "");
        if (!zh) continue;
        html += `<li class="definition-item">
          <span class="def-zh">${zh}</span>
          ${en ? `<span class="def-en">${en}</span>` : ""}
        </li>`;
      }
      html += `</ul></div>`;
    }
    html += `</div>`;
  }

  // 上下文翻译（显示在释义下方）
  if (hasContextTrans) {
    html += `<div class="translation-context">「${escapeHtml(wordData.contextTranslation)}」</div>`;
  }

  el.innerHTML = html || "";

  // 近义词 / 反义词 / 形近词
  renderRelatedWords(wordData);
}

// ─────────────────────────
// 渲染近义词 / 反义词 / 形近词
// ─────────────────────────
function renderRelatedWords(wordData) {
  const container = $("detail-related-words");
  if (!container) return;

  const synonyms = wordData.synonyms || [];
  const antonyms = wordData.antonyms || [];

  if (synonyms.length === 0 && antonyms.length === 0) {
    container.innerHTML = "";
    return;
  }

  let html = `<div class="related-words-section">`;

  if (synonyms.length > 0) {
    html += `<div class="related-group">
      <span class="related-label">近义词</span>
      <div class="related-tags">`;
    for (const s of synonyms) {
      html += `<span class="related-tag related-tag-syn">${escapeHtml(s)}</span>`;
    }
    html += `</div></div>`;
  }

  if (antonyms.length > 0) {
    html += `<div class="related-group">
      <span class="related-label">反义词</span>
      <div class="related-tags">`;
    for (const a of antonyms) {
      html += `<span class="related-tag related-tag-ant">${escapeHtml(a)}</span>`;
    }
    html += `</div></div>`;
  }

  html += `</div>`;
  container.innerHTML = html;
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
  const wordKey = currentDetailWord.word || currentDetailWord._id;
  const displayLabel = currentDetailWord.displayWord || currentDetailWord.word || currentDetailWord._id || "(未知)";
  if (!confirm(`确认删除「${displayLabel}」？`)) return;

  const btn = $("delete-word-btn");
  btn.disabled = true;
  btn.textContent = "删除中...";

  const res = await send({
    type: "DELETE_WORD",
    uid: currentUser.uid,
    word: wordKey,
  });

  if (res.success) {
    // 先重置按钮状态，再关闭弹层，防止下次打开仍是禁用状态
    btn.disabled = false;
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
      <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
    </svg>从生词本删除`;
    closeDetail();
    invalidateWordCaches();
    await refreshAfterMutation();
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
function resetLoginButton() {
  const btn = $("login-btn");
  if (!btn) return;
  btn.disabled = false;
  btn.innerHTML = LOGIN_BUTTON_HTML;
}

function showLoginError(message) {
  const el = $("login-error");
  el.textContent = message;
  el.classList.remove("hidden");
}

function getCurrentSort() {
  return $("sort-select").value || "count";
}

function getCurrentQuery() {
  return $("search-input").value.trim().toLowerCase();
}

function invalidateWordCaches() {
  pageCache.clear();
  pageTokenCache.clear();
  fullWordCache = {
    sort: "",
    words: [],
    loadingPromise: null,
  };
}

async function refreshAfterMutation() {
  await loadActiveView({ forceRefresh: true });

  if (!isSearchMode && currentPage > 1 && allWords.length === 0) {
    currentPage -= 1;
    await loadActiveView({ forceRefresh: true });
  }
}

function getFriendlyErrorMessage(error, context = "general") {
  const raw = String(error || "").trim();
  const lower = raw.toLowerCase();

  if (!navigator.onLine) {
    return context === "login" ? "网络似乎断开了，请检查连接后再试一次。" : "网络有点不稳定，稍后再试一次就好。";
  }

  if (
    lower.includes("the user did not approve") ||
    lower.includes("user cancelled") ||
    lower.includes("user canceled") ||
    lower.includes("canceled") ||
    lower.includes("cancelled")
  ) {
    return context === "login" ? "你刚刚取消了登录授权，准备好后再试一次即可。" : "这次操作已取消。";
  }

  if (
    lower.includes("oauth2 not granted or revoked") ||
    lower.includes("invalid_client") ||
    lower.includes("origin_mismatch") ||
    lower.includes("unauthorized_domain") ||
    lower.includes("configuration_not_found")
  ) {
    return context === "login"
      ? "登录配置还没有完成，请检查 OAuth Client ID 和 Firebase 授权域设置。"
      : "当前账号配置还没准备好，请重新登录后再试。";
  }

  if (
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("network request failed") ||
    lower.includes("fetch")
  ) {
    return context === "login"
      ? "现在网络不太稳定，暂时没连上登录服务，请稍后再试。"
      : "网络有点不稳定，词库暂时没加载出来，请稍后重试。";
  }

  if (lower.includes("permission") || lower.includes("insufficient permissions") || lower.includes("403")) {
    return "当前账号暂时没有访问词库的权限，请重新登录后再试。";
  }

  if (lower.includes("refresh token")) {
    return "登录状态已经过期，请重新登录一次。";
  }

  if (lower.includes("无响应")) {
    return "插件后台暂时没有响应，关闭弹窗后再试一次。";
  }

  if (context === "login") {
    return raw || "登录暂时没有成功，请稍后再试。";
  }

  if (context === "loadWords") {
    return raw || "词库暂时没有加载出来，请稍后重试。";
  }

  return raw || "出了点小问题，请稍后再试。";
}

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

// ─────────────────────────
// 翻译设置面板
// ─────────────────────────
$("settings-btn").addEventListener("click", openSettings);
$("close-settings").addEventListener("click", closeSettings);
$("settings-panel").addEventListener("click", (e) => {
  if (e.target === $("settings-panel")) closeSettings();
});
$("translate-provider-mymemory").addEventListener("change", () => {
  $("google-key-section").classList.add("hidden");
});
$("translate-provider-google").addEventListener("change", () => {
  $("google-key-section").classList.remove("hidden");
});
$("save-settings-btn").addEventListener("click", saveTranslateSettings);

// ─────────────────────────
// 清空词库
// ─────────────────────────
$("clear-words-btn").addEventListener("click", async () => {
  if (!currentUser) return;
  let wordsToClear = [];
  try {
    wordsToClear = await ensureAllWordsForCurrentSort();
  } catch (error) {
    showSettingsMsg(getFriendlyErrorMessage(error?.message || error, "loadWords"), "error");
    return;
  }

  if (wordsToClear.length === 0) {
    showSettingsMsg("当前词库已经是空的", "error");
    return;
  }
  if (!confirm(`确认清空全部 ${wordsToClear.length} 个生词？此操作不可恢复。`)) return;

  const btn = $("clear-words-btn");
  btn.disabled = true;
  btn.textContent = "清空中...";

  const res = await send({ type: "CLEAR_ALL_WORDS", uid: currentUser.uid });
  btn.disabled = false;
  btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
    <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
  </svg>清空全部生词`;
  if (res.success) {
    invalidateWordCaches();
    allWords = [];
    filteredWords = [];
    searchResults = [];
    closeSettings();
    currentPage = 1;
    await loadActiveView({ resetPage: true, forceRefresh: true });
  } else {
    showSettingsMsg("清空失败，请重试", "error");
  }
});

async function openSettings() {
  await loadTranslateSettings();
  $("settings-msg").classList.add("hidden");
  $("settings-panel").classList.remove("hidden");
}

function closeSettings() {
  $("settings-panel").classList.add("hidden");
}

async function loadTranslateSettings() {
  const settings = await new Promise((resolve) =>
    chrome.storage.sync.get(["translationProvider", "googleTranslateApiKey"], resolve),
  );
  const provider = settings.translationProvider || "mymemory";
  $("translate-provider-mymemory").checked = provider === "mymemory";
  $("translate-provider-google").checked = provider === "google";
  $("google-api-key-input").value = settings.googleTranslateApiKey || "";
  $("google-key-section").classList.toggle("hidden", provider !== "google");
}

async function saveTranslateSettings() {
  const provider = $("translate-provider-google").checked ? "google" : "mymemory";
  const apiKey = $("google-api-key-input").value.trim();

  if (provider === "google" && !apiKey) {
    showSettingsMsg("请填写 Google API Key", "error");
    return;
  }

  const btn = $("save-settings-btn");
  btn.disabled = true;
  btn.textContent = "保存中...";

  await new Promise((resolve) =>
    chrome.storage.sync.set({ translationProvider: provider, googleTranslateApiKey: apiKey }, resolve),
  );

  btn.disabled = false;
  btn.textContent = "保存设置";
  showSettingsMsg(
    provider === "google" ? "已保存，将使用 Google 翻译" : "已保存，将使用免费翻译（MyMemory）",
    "success",
  );
}

function showSettingsMsg(msg, type) {
  const el = $("settings-msg");
  el.textContent = msg;
  el.className = `settings-msg settings-msg-${type}`;
}

// 启动
init();

// 捐赠 QR 码占位处理：如果图片不存在则显示占位块
const donateQrImg = $("donate-qr-img");
const donateQrPlaceholder = $("donate-qr-placeholder");
if (donateQrImg && donateQrPlaceholder) {
  donateQrImg.addEventListener("error", () => {
    donateQrImg.style.display = "none";
    donateQrPlaceholder.style.display = "flex";
  });
  donateQrImg.addEventListener("load", () => {
    donateQrImg.style.display = "block";
    donateQrPlaceholder.style.display = "none";
  });
}
