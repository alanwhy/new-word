# 新词本 Chrome 扩展发布全过程

本文档整理了本项目首次发布到 Chrome Web Store 的完整过程，基于当前仓库的实际配置、打包脚本和本次上架流程。

## 1. 发布前准备

发布前需要先确认以下内容：

- Firebase 项目已创建并可用。
- Firestore 数据库已创建，且安全规则已限制为用户只能读写自己的词库。
- Google 登录已在 Firebase Authentication 中启用。
- Chrome 扩展 OAuth Client 已创建并与正式扩展 ID 绑定。
- 扩展图标、商店图标、截图、隐私政策 URL 已准备好。

本项目相关文件：

- [manifest.json](../manifest.json)：扩展清单、权限、OAuth2 client_id、正式商店 key。
- [firebase-config.js](../firebase-config.js)：Firebase 项目配置。
- [tools/package-extension.sh](../tools/package-extension.sh)：发布包打包脚本。
- [privacy-policy.md](../privacy-policy.md)：隐私政策 Markdown 版本。
- [privacy-policy.html](../privacy-policy.html)：可公开访问的隐私政策页面。

## 2. Firebase 配置

### 2.1 创建 Firebase 项目

在 Firebase Console 中创建项目，并启用：

- Authentication
- Firestore Database

### 2.2 Firestore 安全规则

本项目使用的核心规则是：

```text
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/words/{wordId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

这意味着所有用户共享同一个 Firebase 项目，但每个用户只能访问 `users/{uid}/words/*` 下属于自己的数据。

### 2.3 Firebase 授权域

发布时必须在 Firebase Authentication 中添加授权域：

```text
polhbggmgpomnclejjllealbdkoahidl.chromiumapp.org
```

注意：不是 `chrome-extension://...`，而是 `扩展ID.chromiumapp.org`。

## 3. Chrome Web Store 与 OAuth 配置

### 3.1 注册开发者账号

在 Chrome Web Store Developer Dashboard 中完成：

- 开发者注册
- 一次性开发者费用支付
- 开发者信息填写

### 3.2 上传草稿，获取正式扩展 ID

首次发布时先上传 zip 包为草稿，记录正式扩展 ID：

```text
polhbggmgpomnclejjllealbdkoahidl
```

### 3.3 创建正式 OAuth Client

在 Google Cloud Console 中：

- 选择与 Firebase 相同的项目
- 配置 OAuth 同意屏幕
- 创建 OAuth 客户端 ID
- 类型选择“Chrome 扩展程序”
- 填入正式扩展 ID

本次创建出的正式 `client_id`：

```text
794172817025-l8umu1hdmbamubearpk5c91n58dv0fa2.apps.googleusercontent.com
```

然后回填到 [manifest.json](../manifest.json) 的 `oauth2.client_id`。

### 3.4 固定本地与商店一致的扩展 ID

如果本地“加载已解压的扩展程序”和商店草稿的扩展 ID 不一致，Google 登录会出现 `bad client id`。

解决方式：

- 在 Chrome Web Store 草稿的“文件包”页查看公钥
- 去掉 `BEGIN PUBLIC KEY` / `END PUBLIC KEY` 和换行
- 把一整行公钥写入 [manifest.json](../manifest.json) 的 `key` 字段

这样本地扩展 ID 就会与商店正式 ID 一致。

## 4. 打包发布

### 4.1 打包命令

```bash
chmod +x tools/package-extension.sh
./tools/package-extension.sh
```

### 4.2 打包输出

输出文件位于：

```text
dist/new-word-v1.0.0.zip
```

### 4.3 打包内容

打包脚本当前会包含：

- `manifest.json`
- `background.js`
- `content.js`
- `content.css`
- `popup.html`
- `popup.js`
- `popup.css`
- `firebase-config.js`
- `icons/`

不会包含：

- `ai-chat/`
- `tools/`
- `README.md`
- `firebase-config.example.js`
- `docs/`

## 5. 商店资料填写

### 5.1 商品详情

已完成的内容包括：

- 商品说明
- 类别
- 语言
- 商店图标
- 屏幕截图

屏幕截图至少应覆盖以下功能：

- 弹窗词库主界面
- 网页中收藏英文单词
- 单词详情中的翻译与近反义词

### 5.2 隐私权

已填写：

- 单一用途说明
- 每个权限的申请理由
- 数据使用声明
- 隐私政策 URL
- 不使用远程代码

隐私政策 URL：

```text
https://alanwhy.github.io/new-word/privacy-policy.html
```

### 5.3 测试说明

审核员无需开发者提供专门测试账号，可直接使用自己的 Google 账号登录测试。

核心测试路径：

1. 点击扩展图标
2. 使用 Google 账号登录
3. 打开任意英文网页
4. 选中英文单词并收藏
5. 回到弹窗查看词库
6. 打开单词详情并触发翻译

### 5.4 分发

本次选择：

- 免费
- 公开
- 所有地区

## 6. 发布过程中遇到的问题与解决方式

### 6.1 `bad client id`

原因：

- 本地扩展 ID 与 Chrome Web Store 草稿的正式扩展 ID 不一致

解决：

- 从商店获取公钥
- 写入 [manifest.json](../manifest.json) 的 `key`
- 重新加载扩展

### 6.2 GitHub Pages 404

原因：

- 仓库虽然开启了 Pages，但根目录没有可直接访问的静态入口页面

解决：

- 新增 [index.html](../index.html)
- 新增 [privacy-policy.html](../privacy-policy.html)
- 推送到 GitHub 后，隐私政策链接可正常访问

### 6.3 “所有网站的权限”提示

原因：

- 扩展最初通过 `content_scripts` 将 [content.js](../content.js) 注入到 `<all_urls>`

解决：

- 改为在 [background.js](../background.js) 中使用 `chrome.scripting.executeScript()` 按需注入通知 UI
- 从 [manifest.json](../manifest.json) 中移除常驻 `<all_urls>` 注入
- 重新打包后再提交审核

## 7. 当前发布结果

本次提交流程已经完成，状态为：

```text
待审核
```

这意味着：

- 代码包已成功上传
- 商店信息已填写到可提交状态
- 权限说明、隐私说明、测试说明已补齐

## 8. 后续版本更新建议流程

后续更新建议始终按以下顺序进行：

1. 修改代码
2. 如果涉及商店配置，先更新 [manifest.json](../manifest.json)
3. 执行打包脚本
4. 上传新的 zip 覆盖草稿或发布新版本
5. 如有新增权限、数据用途或新功能，同步更新：
   - [privacy-policy.md](../privacy-policy.md)
   - [privacy-policy.html](../privacy-policy.html)
   - Chrome Web Store 商品说明
