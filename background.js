import { FIREBASE_CONFIG, FIRESTORE_BASE_URL } from "./firebase-config.js";

// ─────────────────────────────────────────────
// 词性中文映射表
// ─────────────────────────────────────────────
const POS_ZH_MAP = {
  noun: "名词",
  verb: "动词",
  adjective: "形容词",
  adverb: "副词",
  pronoun: "代词",
  preposition: "介词",
  conjunction: "连词",
  interjection: "感叹词",
  article: "冠词",
  determiner: "限定词",
  exclamation: "感叹词",
  abbreviation: "缩写",
  idiom: "习语",
  prefix: "前缀",
  suffix: "后缀",
  numeral: "数词",
  particle: "助词",
};

// ─────────────────────────────────────────────
// Google OAuth 登录（使用 chrome.identity）
// ─────────────────────────────────────────────

/**
 * 获取当前登录用户的 Google access token
 * @param {boolean} interactive - 是否允许弹出登录界面
 */
async function getGoogleToken(interactive = false) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(token);
      }
    });
  });
}

/**
 * 用 Google access token 换取 Firebase ID token
 */
async function exchangeForFirebaseToken(googleAccessToken) {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${FIREBASE_CONFIG.apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      postBody: `access_token=${googleAccessToken}&providerId=google.com`,
      requestUri: chrome.identity.getRedirectURL(),
      returnIdpCredential: true,
      returnSecureToken: true,
    }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || "Firebase 登录失败");
  }
  return res.json(); // { idToken, localId (uid), email, displayName, ... }
}

/**
 * 获取 Firebase ID token（带自动刷新）
 */
async function getFirebaseIdToken(forceRefresh = false) {
  const stored = await chrome.storage.local.get(["firebaseIdToken", "firebaseTokenExpiry", "firebaseRefreshToken"]);
  const now = Date.now();

  // token 有效且未过期（提前 5 分钟刷新）
  if (
    !forceRefresh &&
    stored.firebaseIdToken &&
    stored.firebaseTokenExpiry &&
    now < stored.firebaseTokenExpiry - 300000
  ) {
    return stored.firebaseIdToken;
  }

  // 如果有 refresh token，用它刷新
  if (stored.firebaseRefreshToken) {
    try {
      const refreshed = await refreshFirebaseToken(stored.firebaseRefreshToken);
      return refreshed.id_token;
    } catch (e) {
      console.warn("刷新 token 失败，重新登录", e);
    }
  }

  // 重新用 Google token 登录
  const googleToken = await getGoogleToken(false);
  const result = await exchangeForFirebaseToken(googleToken);
  await saveAuthState(result);
  return result.idToken;
}

async function refreshFirebaseToken(refreshToken) {
  const url = `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_CONFIG.apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "refresh_token", refresh_token: refreshToken }),
  });
  if (!res.ok) throw new Error("refresh token 失败");
  const data = await res.json();
  await chrome.storage.local.set({
    firebaseIdToken: data.id_token,
    firebaseTokenExpiry: Date.now() + parseInt(data.expires_in) * 1000,
    firebaseRefreshToken: data.refresh_token,
  });
  return data;
}

async function saveAuthState(result) {
  await chrome.storage.local.set({
    firebaseIdToken: result.idToken,
    firebaseTokenExpiry: Date.now() + parseInt(result.expiresIn) * 1000,
    firebaseRefreshToken: result.refreshToken,
    userInfo: {
      uid: result.localId,
      email: result.email,
      displayName: result.displayName,
      photoUrl: result.photoUrl,
    },
  });
}

// ─────────────────────────────────────────────
// Firestore REST API 操作
// ─────────────────────────────────────────────

/**
 * 将 JS 值转换为 Firestore REST 格式
 */
function toFirestoreValue(value) {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "number") return { integerValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (value === null) return { nullValue: null };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toFirestoreValue) } };
  if (typeof value === "object") {
    const fields = {};
    for (const k in value) fields[k] = toFirestoreValue(value[k]);
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

/**
 * 将 Firestore REST 格式转回 JS 值
 */
function fromFirestoreValue(val) {
  if ("stringValue" in val) return val.stringValue;
  if ("integerValue" in val) return parseInt(val.integerValue);
  if ("doubleValue" in val) return val.doubleValue;
  if ("booleanValue" in val) return val.booleanValue;
  if ("timestampValue" in val) return val.timestampValue;
  if ("nullValue" in val) return null;
  if ("arrayValue" in val) return (val.arrayValue.values || []).map(fromFirestoreValue);
  if ("mapValue" in val) {
    const obj = {};
    for (const k in val.mapValue.fields) {
      obj[k] = fromFirestoreValue(val.mapValue.fields[k]);
    }
    return obj;
  }
  return null;
}

function firestoreDocToObj(doc) {
  const obj = { _id: doc.name?.split("/").pop() };
  for (const k in doc.fields || {}) {
    obj[k] = fromFirestoreValue(doc.fields[k]);
  }
  return obj;
}

/**
 * 读取用户的某个单词文档
 */
async function getWordDoc(uid, word) {
  const idToken = await getFirebaseIdToken();
  const docId = encodeURIComponent(word.toLowerCase());
  const url = `${FIRESTORE_BASE_URL}/users/${uid}/words/${docId}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore 读取失败: ${res.status}`);
  return firestoreDocToObj(await res.json());
}

/**
 * 收藏单词：
 * - 新词：写全量文档
 * - 已有词：updateMask 局部更新 count / lastCollectedAt / contexts，不碰 translations
 */
async function saveWord(uid, word, context, pageUrl, pageTitle) {
  const idToken = await getFirebaseIdToken();
  const docId = encodeURIComponent(word.toLowerCase());
  const url = `${FIRESTORE_BASE_URL}/users/${uid}/words/${docId}`;
  const now = new Date().toISOString();

  const existing = await getWordDoc(uid, word);

  // 安全地取 count，防止脏数据导致 NaN
  const prevCount = existing ? Number(existing.count) || 0 : 0;
  const newCount = prevCount + 1;

  // 拼接上下文，空字段降级为空字符串避免 undefined 写入 Firestore
  const newContext = {
    text: context || "",
    url: pageUrl || "",
    title: pageTitle || "",
    time: now,
  };
  const newContexts = [...(existing?.contexts || []).slice(-4), newContext];

  if (!existing) {
    // ── 新词：写全量文档 ──────────────────────
    const fields = {
      word: toFirestoreValue(word.toLowerCase()),
      displayWord: toFirestoreValue(word),
      count: toFirestoreValue(newCount),
      firstCollectedAt: toFirestoreValue(now),
      lastCollectedAt: toFirestoreValue(now),
      contexts: toFirestoreValue(newContexts),
    };
    const res = await fetch(url, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error?.message || "Firestore 写入失败");
    }
    return firestoreDocToObj(await res.json());
  } else {
    // ── 已有词：updateMask 局部更新，不碰 translations ──
    const fields = {
      count: toFirestoreValue(newCount),
      lastCollectedAt: toFirestoreValue(now),
      contexts: toFirestoreValue(newContexts),
    };
    const patchUrl =
      `${url}?updateMask.fieldPaths=count` +
      `&updateMask.fieldPaths=lastCollectedAt` +
      `&updateMask.fieldPaths=contexts`;
    const res = await fetch(patchUrl, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error?.message || "Firestore 写入失败");
    }
    // 合并返回值（保留 translations 等未更新字段）
    return { ...existing, ...firestoreDocToObj(await res.json()) };
  }
}

/**
 * 获取用户全部生词
 */
async function getAllWords(uid) {
  const idToken = await getFirebaseIdToken();
  // 直接列出子集合，不在 Firestore 端排序（避免需要复合索引）
  // 排序由 popup.js 的 applyFilters() 在前端完成
  const listUrl = `${FIRESTORE_BASE_URL}/users/${uid}/words?pageSize=500`;
  const res = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${idToken}` },
  });

  if (!res.ok) throw new Error("获取生词列表失败");
  const data = await res.json();
  return (data.documents || []).map(firestoreDocToObj);
}

// ─────────────────────────────────────────────
// 翻译：Free Dictionary API + 可选翻译服务
// ─────────────────────────────────────────────

/**
 * 使用 MyMemory 免费翻译（无需 API Key，每 IP 每日约 1000 词）
 */
async function translateWithMyMemory(texts) {
  const results = await Promise.all(
    texts.map(async (text) => {
      const t = (text || "").trim().slice(0, 500);
      if (!t) return "";
      try {
        const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(t)}&langpair=en|zh-CN`);
        if (!res.ok) return "";
        const data = await res.json();
        if (data.responseStatus !== 200) return "";
        return data.responseData?.translatedText || "";
      } catch {
        return "";
      }
    }),
  );
  return results;
}

/**
 * 使用用户自定义的 Google Cloud Translation API Key 翻译
 */
async function translateWithGoogle(texts, apiKey) {
  const res = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ q: texts, source: "en", target: "zh-CN", format: "text" }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || "Google 翻译失败");
  }
  const data = await res.json();
  return (data.data?.translations || []).map((t) => t.translatedText);
}

/**
 * 根据用户设置选择翻译服务（MyMemory 免费 或 Google 自定义 Key）
 */
async function translateTexts(texts) {
  const settings = await chrome.storage.sync.get(["translationProvider", "googleTranslateApiKey"]);
  if (settings.translationProvider === "google" && settings.googleTranslateApiKey) {
    return translateWithGoogle(texts, settings.googleTranslateApiKey);
  }
  return translateWithMyMemory(texts);
}

/**
 * 通过 Free Dictionary API 获取词条（词性 + 英文释义），
 * 再通过当前翻译服务批量翻译为中文。
 *
 * 返回结构：
 * {
 *   contextTranslation: string,        // 上下文句子的中文翻译
 *   translations: [{
 *     pos: string,                      // 词性（英文，如 "noun"）
 *     posZh: string,                    // 词性（中文，如 "名词"）
 *     definitions: [{ en, zh }]         // 每条释义的英中对照
 *   }]
 * }
 */
async function fetchWordTranslations(word, context) {
  const result = { contextTranslation: "", translations: [] };

  // ── 1. Free Dictionary API 获取词性和英文释义 ──
  let dictData = null;
  try {
    const dictRes = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`,
    );
    if (dictRes.ok) dictData = await dictRes.json();
  } catch (e) {
    console.warn("[translate] Dictionary API 失败，将仅做上下文翻译", e);
  }

  // ── 2. 提取词性分组（每个词性最多 3 条释义，去重）──
  const posGroups = {}; // { "noun": ["def1", "def2", ...] }
  if (Array.isArray(dictData)) {
    for (const entry of dictData) {
      for (const meaning of entry.meanings || []) {
        const pos = meaning.partOfSpeech?.toLowerCase();
        if (!pos) continue;
        if (!posGroups[pos]) posGroups[pos] = [];
        for (const def of meaning.definitions || []) {
          if (posGroups[pos].length >= 3) break;
          if (def.definition && !posGroups[pos].includes(def.definition)) {
            posGroups[pos].push(def.definition);
          }
        }
      }
    }
  }

  // ── 3. 构建批量翻译列表 ──
  // 索引 0：上下文句子（或单词本身，用于上下文翻译）
  const textsToTranslate = [context?.trim() || word];
  const indexMap = []; // 记录 [1..] 各文本对应的 { pos, defIdx }
  for (const pos of Object.keys(posGroups)) {
    for (let i = 0; i < posGroups[pos].length; i++) {
      textsToTranslate.push(posGroups[pos][i]);
      indexMap.push({ pos, defIdx: i });
    }
  }

  // ── 4. 调用翻译服务（MyMemory 免费 或 用户自定义 Google Key）──
  let translatedTexts = [];
  try {
    translatedTexts = await translateTexts(textsToTranslate);
  } catch (e) {
    console.warn("[translate] 翻译失败", e);
  }

  // ── 5. 整理结果 ──
  result.contextTranslation = translatedTexts[0] || "";

  // 按词性组织翻译结果
  const posDefs = {}; // { "noun": [{ en, zh }] }
  for (let i = 0; i < indexMap.length; i++) {
    const { pos, defIdx } = indexMap[i];
    if (!posDefs[pos]) posDefs[pos] = [];
    posDefs[pos].push({
      en: posGroups[pos][defIdx],
      zh: translatedTexts[i + 1] || "",
    });
  }

  result.translations = Object.entries(posDefs).map(([pos, definitions]) => ({
    pos,
    posZh: POS_ZH_MAP[pos] || pos,
    definitions,
  }));

  return result;
}

/**
 * 删除某个单词（word 可以是单词字符串，也可以直接是文档 ID）
 */
async function deleteWord(uid, word) {
  if (!word) return; // 跳过脏数据
  const idToken = await getFirebaseIdToken();
  const docId = encodeURIComponent(word.toLowerCase());
  const url = `${FIRESTORE_BASE_URL}/users/${uid}/words/${docId}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!res.ok && res.status !== 404) throw new Error("删除失败");
}

// ─────────────────────────────────────────────
// 消息监听（来自 content script / popup）
// ─────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((err) => {
      console.error("[background] 错误:", err);
      sendResponse({ success: false, error: err.message });
    });
  return true; // 保持 sendResponse 通道异步开放
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case "LOGIN": {
      const googleToken = await getGoogleToken(true);
      const result = await exchangeForFirebaseToken(googleToken);
      await saveAuthState(result);
      return { success: true, user: { uid: result.localId, email: result.email, displayName: result.displayName } };
    }

    case "LOGOUT": {
      await chrome.identity.clearAllCachedAuthTokens();
      await chrome.storage.local.remove(["firebaseIdToken", "firebaseTokenExpiry", "firebaseRefreshToken", "userInfo"]);
      return { success: true };
    }

    case "GET_USER": {
      const stored = await chrome.storage.local.get("userInfo");
      return { success: true, user: stored.userInfo || null };
    }

    case "SAVE_WORD": {
      const { uid } = message;
      const doc = await saveWord(uid, message.word, message.context, message.pageUrl, message.pageTitle);
      return { success: true, word: doc };
    }

    case "GET_ALL_WORDS": {
      const { uid } = message;
      const words = await getAllWords(uid);
      return { success: true, words };
    }

    case "DELETE_WORD": {
      const { uid, word } = message;
      await deleteWord(uid, word);
      return { success: true };
    }

    case "CLEAR_ALL_WORDS": {
      const { uid } = message;
      const words = await getAllWords(uid);
      // 优先用 w.word，脏数据没有 word 字段时降级用文档 ID（_id）
      await Promise.all(words.map((w) => deleteWord(uid, w.word || w._id)));
      return { success: true };
    }

    case "TRANSLATE_WORD": {
      // 为已存在的单词（手动触发）获取翻译，写回 Firestore 并返回结果
      const { uid, word, context } = message;
      const wordTranslations = await fetchWordTranslations(word, context);
      const idToken = await getFirebaseIdToken();
      const docId = encodeURIComponent(word.toLowerCase());
      const patchUrl =
        `${FIRESTORE_BASE_URL}/users/${uid}/words/${docId}` +
        `?updateMask.fieldPaths=contextTranslation&updateMask.fieldPaths=translations`;
      const patchFields = {
        contextTranslation: toFirestoreValue(wordTranslations.contextTranslation),
        translations: toFirestoreValue(wordTranslations.translations),
      };
      const patchRes = await fetch(patchUrl, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ fields: patchFields }),
      });
      if (!patchRes.ok) throw new Error("翻译写入 Firestore 失败");
      return { success: true, ...wordTranslations };
    }

    default:
      return { success: false, error: "未知消息类型" };
  }
}

// 安装时注册右键菜单
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "save-word",
    title: '收藏 "%s" 到生词本',
    contexts: ["selection"],
  });
});

// 右键菜单点击
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "save-word") return;
  const selectedText = info.selectionText?.trim();
  if (!selectedText) return;

  const stored = await chrome.storage.local.get("userInfo");
  if (!stored.userInfo) {
    // 未登录，通知 content script 显示登录提示
    chrome.tabs.sendMessage(tab.id, { type: "NEED_LOGIN" });
    return;
  }

  try {
    const doc = await saveWord(stored.userInfo.uid, selectedText, "", tab.url, tab.title);
    // 优先通过 content script 消息通知，失败时直接注入通知到页面
    chrome.tabs.sendMessage(tab.id, { type: "WORD_SAVED", word: selectedText, count: doc.count }, () => {
      if (chrome.runtime.lastError) {
        // content script 未就绪，直接注入通知代码
        chrome.scripting
          .executeScript({
            target: { tabId: tab.id },
            func: (word, count) => {
              const notif = document.createElement("div");
              notif.style.cssText = [
                "position:fixed",
                "bottom:24px",
                "right:24px",
                "z-index:2147483647",
                "display:flex",
                "align-items:center",
                "gap:8px",
                "padding:10px 16px",
                "background:#1e1b4b",
                "color:#e0e7ff",
                "border-radius:10px",
                "font-size:13px",
                "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
                "box-shadow:0 8px 30px rgba(0,0,0,.25)",
                "pointer-events:none",
                "max-width:320px",
                "transition:opacity .3s ease,transform .3s ease",
                "opacity:0",
                "transform:translateY(12px)",
              ].join(";");
              notif.innerHTML = `<span>📖 <b>${word}</b> 已收藏，共 ${count} 次</span>`;
              document.body.appendChild(notif);
              requestAnimationFrame(() => {
                notif.style.opacity = "1";
                notif.style.transform = "translateY(0)";
              });
              setTimeout(() => {
                notif.style.opacity = "0";
                notif.style.transform = "translateY(12px)";
                setTimeout(() => notif.remove(), 400);
              }, 2500);
            },
            args: [selectedText, doc.count],
          })
          .catch(() => {});
      }
    });
  } catch (e) {
    console.error("右键收藏失败", e);
  }
});
