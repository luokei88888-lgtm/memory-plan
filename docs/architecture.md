# 技术架构

## 总体架构

```
┌─────────────────────────────────────────────┐
│              微信小程序（原生）                │
│  首页 / 对话 / 计划 / 复习 / 我的             │
└──────────────────┬──────────────────────────┘
                   │ wx.cloud.callFunction
┌──────────────────▼──────────────────────────┐
│              微信云开发                        │
│  ┌─────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ 云函数   │ │ 云数据库  │ │  环境变量     │  │
│  │ login   │ │ users    │ │  AI_API_KEY  │  │
│  │ chat    │ │ plans    │ │  AI_BASE_URL │  │
│  │ generate│ │ cards    │ │  AI_MODEL    │  │
│  │ review  │ │ logs     │ └──────────────┘  │
│  │ getToday│ │ convs    │                   │
│  └────┬────┘ └──────────┘                   │
└───────┼─────────────────────────────────────┘
        │ HTTPS
┌───────▼────────┐
│  DeepSeek 等   │
│  （可热切换）   │
└────────────────┘
```

## 核心流程

### 1. 制定计划
用户在对话中描述目标 → `chat` 识别意图 → 调用 `generatePlan` → AI 返回结构化 JSON（周计划 + 知识点）→ 写入 `study_plans` + 批量写入 `knowledge_cards`（初始 `nextReviewAt = 今天`）

### 2. 复习
首页 `getToday` 拉取 `nextReviewAt <= now` 的卡片 → 进入 `review` 页 → AI/卡片出题 → 用户作答 → 按 SM-2 变体更新 `interval / easeFactor / nextReviewAt`

### 3. 提醒（M2）
定时触发器扫描明日待复习用户 → 发订阅消息

## AI 接入约定

所有云函数通过 `common/ai.js` 调用大模型，统一接口：

```js
chatCompletion({ messages, temperature, responseFormat })
```

换模型只改环境变量，不改业务代码。
