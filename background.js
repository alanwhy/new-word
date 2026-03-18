import { FIREBASE_CONFIG, FIRESTORE_BASE_URL } from "./firebase-config.js";

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
 * 收藏单词（新增或 count+1）
 */
async function saveWord(uid, word, context, pageUrl, pageTitle) {
  const idToken = await getFirebaseIdToken();
  const docId = encodeURIComponent(word.toLowerCase());
  const url = `${FIRESTORE_BASE_URL}/users/${uid}/words/${docId}`;

  // 先尝试读取已有数据
  const existing = await getWordDoc(uid, word);
  const now = new Date().toISOString();

  const fields = {
    word: toFirestoreValue(word.toLowerCase()),
    displayWord: toFirestoreValue(word),
    count: toFirestoreValue(existing ? existing.count + 1 : 1),
    firstCollectedAt: toFirestoreValue(existing ? existing.firstCollectedAt : now),
    lastCollectedAt: toFirestoreValue(now),
    // 保存最近几次的上下文
    contexts: toFirestoreValue([
      ...(existing?.contexts || []).slice(-4),
      { text: context, url: pageUrl, title: pageTitle, time: now },
    ]),
  };

  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || "Firestore 写入失败");
  }
  return firestoreDocToObj(await res.json());
}

/**
 * 获取用户全部生词，按 count 降序
 */
async function getAllWords(uid) {
  const idToken = await getFirebaseIdToken();
  // 使用 runQuery 支持排序
  const url = `${FIRESTORE_BASE_URL}:runQuery`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: "words", allDescendants: false }],
      where: {
        fieldFilter: {
          field: { fieldPath: "__name__" },
          op: "GREATER_THAN_OR_EQUAL",
          value: { referenceValue: `${FIRESTORE_BASE_URL}/users/${uid}/words/` },
        },
      },
      orderBy: [{ field: { fieldPath: "count" }, direction: "DESCENDING" }],
      limit: 200,
    },
  };

  // 使用集合组查询更简单的方式：直接列出子集合
  const listUrl = `${FIRESTORE_BASE_URL}/users/${uid}/words?orderBy=count%20desc&pageSize=200`;
  const res = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${idToken}` },
  });

  if (!res.ok) throw new Error("获取生词列表失败");
  const data = await res.json();
  return (data.documents || []).map(firestoreDocToObj);
}

/**
 * 删除某个单词
 */
async function deleteWord(uid, word) {
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
    chrome.tabs.sendMessage(tab.id, {
      type: "WORD_SAVED",
      word: selectedText,
      count: doc.count,
    });
  } catch (e) {
    console.error("右键收藏失败", e);
  }
});
