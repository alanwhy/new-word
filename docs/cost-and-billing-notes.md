# 新词本费用与计费说明

本文档整理当前项目在发布和运行过程中所有可能涉及的费用、计费方式、费用归属，以及基于当前实现的大致成本判断。

## 1. 结论先看

当前项目最现实的持续成本来源是：

- Firestore 读取、写入、删除、存储、出站流量

当前项目默认不会替用户承担的费用是：

- Google Translate API 文本翻译费用

原因是当前翻译逻辑由用户自己提供 Google Translate API Key，或者走 MyMemory 免费翻译。

## 2. 当前项目涉及的外部服务

从 [background.js](../background.js)、[firebase-config.js](../firebase-config.js)、[manifest.json](../manifest.json) 可确认当前使用了这些服务：

- Firebase Authentication
- Cloud Firestore
- Chrome Identity / Google OAuth
- MyMemory Translation API
- Free Dictionary API
- Google Cloud Translation API（仅用户主动填写自己的 API Key 时）

## 3. 所有可能付费的项目

## 3.1 Chrome Web Store 开发者注册费

性质：

- 一次性费用

说明：

- 用于注册 Chrome Web Store 开发者账号
- 不属于按月运行成本

## 3.2 Cloud Firestore

这是当前最主要的长期成本来源。

### 计费项

- 文档读取
- 文档写入
- 文档删除
- 存储空间
- 网络出站流量

如果未来启用了以下功能，还会增加费用：

- PITR
- 备份
- 恢复
- 克隆

### 当前免费额度

官方当前给出的免费额度包括：

- 存储：1 GiB
- 文档读取：每天 50,000 次
- 文档写入：每天 20,000 次
- 文档删除：每天 20,000 次
- 出站流量：每月 10 GiB

### 示例单价

以官方文档示例区域 `us-central1` 为例，超出免费额度后大约是：

- 读取：US$0.03 / 100,000 次
- 写入：US$0.09 / 100,000 次
- 删除：US$0.01 / 100,000 次

注意：实际价格与区域相关，这里只是量级参考。

## 3.3 Firebase Authentication

### 基础判断

当前扩展使用 Google 登录，再换取 Firebase ID Token。

### 是否会收费

- 基础 Firebase Auth 通常不是当前主要成本来源
- 但如果你启用了 Firebase Authentication with Identity Platform 升级版，则 Blaze 下会按 MAU 计费

### Identity Platform 文档口径

当前官方说明：

- 前 50,000 MAU 免费
- 超出后按 MAU 收费

### 对当前项目的实际影响

如果你没有主动升级到 Identity Platform，这项暂时不必视作主要成本。

## 3.4 Google Cloud Translation API

### 当前实现方式

在 [background.js](../background.js) 中，Google 翻译调用使用的是用户在设置页中保存的 `googleTranslateApiKey`。

这意味着：

- 默认情况下，用户使用 MyMemory 免费翻译，不走你的 Google Cloud 账单
- 如果用户自己填写 Google Translate API Key，则账单归用户自己的 key 所属项目

### 只有以下情况才会花你的钱

- 你自己在测试时填了你自己的 Google Translate API Key
- 未来你把扩展改成统一使用你提供的服务器端或固定 API Key

### 官方价格量级

Cloud Translation 基本版当前文档写的是：

- 每月前 500,000 字符有免费赠金额度
- 超过后：US$20 / 1,000,000 字符

## 3.5 MyMemory Translation API

### 当前实现方式

MyMemory 是当前默认翻译服务。

### 是否花你钱

- 不走你的 Google Cloud 账单
- 但存在第三方服务限制与稳定性风险

### 风险点

- 免费额度限制
- 结果质量不稳定
- 第三方条款可能变化

## 3.6 Free Dictionary API

### 是否花你钱

- 不产生你的 Google Cloud 费用

### 风险点

- 数据不完整
- 服务不可用时会影响翻译体验

## 3.7 Cloud Storage

虽然 [firebase-config.js](../firebase-config.js) 中有 `storageBucket`，但当前代码没有使用 Firebase Storage 上传任何文件。

结论：

- 当前基本没有这项费用

## 3.8 Google Analytics / Measurement

Firebase 配置里有 `measurementId`，但当前代码没有真正发送相关统计事件。

结论：

- 当前可以视为无实际成本

## 4. 当前代码中，一次用户操作对应的成本

## 4.1 打开弹窗一次

在 [popup.js](../popup.js) 初始化时会读取全部词库，对应 [background.js](../background.js) 的 `GET_ALL_WORDS`。

如果用户有 $N$ 个单词，则打开弹窗一次大约是：

$$
N \text{ 次读取}
$$

这是当前最主要的 Firestore 成本来源。

## 4.2 收藏一个单词

在 [background.js](../background.js) 的 `saveWord()` 中：

- 先读取单词文档是否存在：约 1 次读取
- 再 PATCH 写入：约 1 次写入

可近似记为：

$$
1 \text{ 读} + 1 \text{ 写}
$$

## 4.3 翻译一个单词

在 [background.js](../background.js) 的 `TRANSLATE_WORD` 中：

- 外部词典和翻译 API 调用
- 翻译结果写回 Firestore：约 1 次写入

结论：

- Firestore 侧约 1 次写入
- 默认不花你的 Google 翻译费用

## 4.4 删除一个单词

约等于：

$$
1 \text{ 次删除}
$$

## 4.5 清空全部单词

当前实现是：

- 先读取全部单词：$N$ 次读取
- 再逐个删除：$N$ 次删除

因此大约是：

$$
N \text{ 读} + N \text{ 删}
$$

## 5. 费用归属

## 5.1 你的费用

以下通常是你承担：

- Firestore 读写删存储
- Firestore 出站流量
- Firebase Authentication 所属项目成本
- Chrome Web Store 开发者注册费

## 5.2 用户自己的费用

以下在当前实现里通常是用户承担：

- 用户自己填写的 Google Translate API Key 所产生的翻译费用

## 5.3 默认不会产生你费用的部分

- MyMemory 免费翻译
- Free Dictionary API

## 6. 成本场景估算

以下估算主要基于 Firestore 读取成本，因为这是当前实现中最显著的变量。

## 6.1 小规模场景

假设：

- 100 个活跃用户
- 每人平均 100 个词
- 每天打开弹窗 2 次
- 每天收藏 1 个词

每天大约：

- 弹窗读取：100 × 100 × 2 = 20,000 读
- 收藏读取：100 读
- 收藏写入：100 写

结果：

- 每天约 20,100 读、100 写
- 还在 Firestore 免费额度内
- 成本几乎可以视为 0

## 6.2 中等规模场景

假设：

- 1,000 个活跃用户
- 每人平均 200 个词
- 每天打开弹窗 2 次
- 每天收藏 1 个词

每天大约：

- 弹窗读取：1,000 × 200 × 2 = 400,000 读
- 收藏读取：1,000 读
- 收藏写入：1,000 写

超出免费读取额度：

$$
401,000 - 50,000 = 351,000 \text{ 读/天}
$$

按 US$0.03 / 100,000 读估算：

$$
351,000 / 100,000 \times 0.03 \approx 0.1053 \text{ 美元/天}
$$

约等于：

$$
3.16 \text{ 美元/月}
$$

## 6.3 1 万活跃用户场景

假设：

- 10,000 个活跃用户
- 每人平均 300 个词
- 每天打开弹窗 2 次
- 每天收藏 1 个词

每天大约：

- 弹窗读取：10,000 × 300 × 2 = 6,000,000 读
- 收藏读取：10,000 读
- 收藏写入：10,000 写

超出免费读取额度：

$$
6,010,000 - 50,000 = 5,960,000 \text{ 读/天}
$$

按 US$0.03 / 100,000 读估算：

$$
5,960,000 / 100,000 \times 0.03 \approx 1.788 \text{ 美元/天}
$$

约等于：

$$
53.64 \text{ 美元/月}
$$

在这个量级下，写入仍可能低于每天 20,000 次免费额度。

## 7. 当前最值得关注的成本热点

优先级从高到低：

1. 弹窗打开时全量拉取词库
2. Firestore 存储增长
3. Firestore 出站流量
4. 如果未来统一提供 Google 翻译 key，则 Translation API 成本

## 8. 降低成本的建议

### 8.1 优先优化全量读取

建议顺序：

1. 分页读取
2. 本地缓存
3. 增量同步

### 8.2 保持翻译为手动触发

不要在收藏时自动为每个词做翻译，这能减少：

- 第三方 API 调用
- Firestore 写入
- 收藏时延迟

### 8.3 设置预算与提醒

建议在 Google Cloud Billing 中设置：

- 月预算：US$10 或更低
- 50%、80%、100% 邮件提醒

### 8.4 定期查看 Firestore 用量

重点关注：

- 文档读取
- 文档写入
- 文档删除
- 存储大小
- 出站流量

## 9. 一句话总结

当前项目确实可能产生费用，但在真实早期规模下，最主要的成本通常只是 Firestore 的读取费用，而且大概率仍处于较低量级。真正需要优先防范的不是 Google 登录账单，而是“随着词库变大，每次打开弹窗都全量拉词库”带来的累计读取成本。
