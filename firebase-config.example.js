// ⚠️ 请将下方替换为你在 Firebase Console 获取的配置
// 详细步骤见 README.md
// ⚠️ 使用翻译功能前，需在 Google Cloud Console 中为本项目启用 Cloud Translation API：
//    https://console.cloud.google.com/apis/library/translate.googleapis.com
//    启用后，下方 apiKey 即可同时用于翻译请求，无需额外密钥。
export const FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID",
  measurementId: "YOUR_MEASUREMENT_ID",
};

// Firebase REST API 基础 URL
export const FIRESTORE_BASE_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents`;
export const AUTH_BASE_URL = "https://identitytoolkit.googleapis.com/v1";
