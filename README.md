# 新词本 Chrome 插件 - 配置指南

## 功能概览

- 在英文网页中选中单词，一键收藏到生词本
- 记录每个单词的累计收藏次数和上下文句子
- 数据同步到 Google 账号（Firebase Firestore）
- Popup 展示生词本，支持按次数 / 时间 / 字母排序和搜索
- 点击单词可手动获取**中文翻译**（词性标注 + 多义项 + 上下文翻译）
- 翻译结果写入云端，之后打开无需重复翻译
- 可在设置中选择翻译服务：**免费翻译（MyMemory，无需 Key）** 或 **Google 翻译（自备 API Key）**

---

## 你需要做的事（两步配置）

---

## 第一步：创建 Firebase 项目

### 1.1 创建项目

1. 打开 [https://console.firebase.google.com](https://console.firebase.google.com)
2. 点击「创建项目」，输入名称（如 `new-word`），按提示完成创建

### 1.2 启用 Google 登录

1. 在左侧菜单 → **Authentication** → **Sign-in method**
2. 点击「Google」→ 启用 → 填入项目支持邮箱 → 保存

### 1.3 创建 Firestore 数据库

1. 在左侧菜单 → **Firestore Database** → 「创建数据库」
2. 选「以生产模式开始」→ 选择离你最近的区域（推荐 `asia-east1`）→ 完成
3. 进入「规则」标签，将内容替换为以下规则后点击发布：

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/words/{wordId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

### 1.4 获取 Firebase 配置

1. 在 Firebase 控制台左上角点击「⚙️ 项目设置」
2. 滚动到「您的应用」→ 点击 `</>` 网页图标添加应用
3. 应用昵称随意，**不需要**启用 Firebase Hosting，点击「注册应用」
4. 复制显示的 `firebaseConfig` 对象内容

### 1.5 填入配置

打开 `firebase-config.js`，将对应字段替换为你复制的内容：

```js
export const FIREBASE_CONFIG = {
  apiKey: "AIza...", // ← 替换
  authDomain: "your-app.firebaseapp.com", // ← 替换
  projectId: "your-app", // ← 替换
  storageBucket: "your-app.appspot.com", // ← 替换
  messagingSenderId: "123456789", // ← 替换
  appId: "1:123:web:abc", // ← 替换
};
```

---

## 第二步：配置 Chrome Extension OAuth Client ID

### 2.1 获取插件 ID（需要先加载插件）

1. 打开 Chrome → 地址栏输入 `chrome://extensions`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」→ 选择本文件夹
4. 记下插件的 **ID**（一串英文字母，如 `abcdefghijklmnopqrstuvwxyz123456`）

### 2.2 在 Google Cloud Console 创建 OAuth Client

1. 打开 [https://console.cloud.google.com](https://console.cloud.google.com)
2. 确保选择的是 Firebase 同一个项目
3. 进入「API 和服务」→「凭据」→「创建凭据」→「OAuth 客户端 ID」
4. 应用类型选「**Chrome 扩展程序**」
5. 在「应用 ID」填入你在 2.1 记下的插件 ID
6. 点击创建，复制生成的**客户端 ID**（格式为 `xxx.apps.googleusercontent.com`）

### 2.3 填入 manifest.json

打开 `manifest.json`，找到 `oauth2` 字段，替换 client_id：

```json
"oauth2": {
  "client_id": "你复制的客户端ID.apps.googleusercontent.com",
  ...
}
```

### 2.4 在 Firebase 中添加授权域

1. 回到 Firebase Console → Authentication → Sign-in method
2. 滚动到「已获授权的网域」→ 添加：`chrome-extension://你的插件ID`

---

## 安装和使用

1. 完成上述配置后，在 `chrome://extensions` 页面刷新插件（或重新加载）
2. 点击 Chrome 工具栏中的「新词本」图标
3. 点击「使用 Google 账号登录」
4. 在任意英文网页，**选中一个英文单词**，上方会出现「收藏」按钮
5. 也可以**右键选中文字** → 「收藏 "xxx" 到生词本」
6. 点击插件图标可查看生词本，支持按收藏次数 / 时间 / 字母排序和搜索
7. 点击任意单词卡片，在详情页点击「**获取中文翻译**」即可翻译（首次需联网，之后从云端直接读取）

---

## 翻译功能配置

插件内置两种翻译服务，点击生词本右上角的 **⚙️ 图标**即可切换：

| 模式             | 服务商       | 费用                                      | 说明                                         |
| ---------------- | ------------ | ----------------------------------------- | -------------------------------------------- |
| 免费翻译（默认） | MyMemory     | 完全免费                                  | 每个 IP 每天约 1000 词额度，个人日常使用足够 |
| Google 翻译      | Google Cloud | 每月 50 万字符免费，超出约 ¥14 / 百万字符 | 需自备 API Key，翻译质量更高                 |

### 如何获取 Google Translate API Key（仅 Google 翻译模式需要）

1. 前往 [console.cloud.google.com](https://console.cloud.google.com)，选择或新建项目
2. 左侧 → 「API 和服务」→「库」，搜索 **Cloud Translation API** 并启用
3. 左侧 → 「API 和服务」→「凭据」→「创建凭据」→「API 密钥」
4. 建议点击「限制密钥」→ API 限制设为 Cloud Translation API，防止滥用
5. 复制密钥，粘贴到插件设置页的输入框中，点击保存

> API Key 保存在 `chrome.storage.sync`（加密存储，不随插件代码分发）。

---

## 项目文件结构

```
new-word/
├── manifest.json              # 插件配置（含 OAuth2 client_id）
├── firebase-config.js         # Firebase 配置（需填写，已加入 .gitignore）
├── firebase-config.example.js # 配置模板（占位符，可公开）
├── background.js              # Service Worker（登录、Firestore 读写、翻译调用）
├── content.js                 # 网页注入脚本（划词收藏、悬浮按钮）
├── content.css                # 网页注入样式
├── popup.html                 # 弹出窗口 HTML
├── popup.css                  # 弹出窗口样式
├── popup.js                   # 弹出窗口逻辑（列表 / 详情 / 翻译 / 设置）
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

---

## 本地开发更新方式

1. 修改代码
2. 打开 `chrome://extensions`
3. 点击「新词本」卡片上的 🔄 刷新按钮

> Chrome 直接读取本地文件夹，不要删除或移动文件夹，否则插件失效。

---

## 常见问题

**Q：首次登录出现「谷歌尚未验证此应用」警告**  
A：开发阶段正常现象，点击「先进的」→「继续」即可。

**Q：翻译结果不准确**  
A：可在设置中切换为 Google 翻译（精度更高），或在详情页上下文翻译中参考句义。

**Q：MyMemory 翻译额度用完了怎么办**  
A：切换到 Google 翻译模式（每月 50 万字符免费额度对个人完全够用）。

**Q：我发布了这个插件，其他用户会走我的翻译账单吗**  
A：不会。默认的 MyMemory 是免费服务，按每个用户自己的 IP 计算额度；Google 翻译需要用户填写自己的 API Key，账单归用户自己。
