# 数据模型（云数据库集合）

## users

| 字段 | 类型 | 说明 |
|------|------|------|
| _id | string | 自动 |
| openid | string | 微信 openid |
| nickname | string | 昵称 |
| avatarUrl | string | 头像 |
| dailyQuota | number | 当日剩余 AI 次数，默认 20 |
| quotaDate | string | YYYY-MM-DD，用于每日重置 |
| adClaimsToday | number | 当日广告领奖次数 |
| shareClaimsToday | number | 当日分享领奖次数 |
| planGenToday | number | 当日生成计划次数（上限防刷） |
| invitedBy | string | 邀请人 userId（一生一次） |
| inviteCount | number | 成功邀请人数 |
| createdAt | Date | |
| updatedAt | Date | |

## conversations

| 字段 | 类型 | 说明 |
|------|------|------|
| _id | string | |
| userId | string | |
| title | string | 会话标题 |
| messages | array | `{ role, content, createdAt }` |
| updatedAt | Date | |

## study_plans

| 字段 | 类型 | 说明 |
|------|------|------|
| _id | string | |
| userId | string | |
| title | string | 如「Java 求职冲刺」 |
| goal | string | 用户目标原文 |
| scene | string | job / exam / skill / interest / language / reading |
| weeks | array | `[{ week, theme, topics: string[] }]` |
| status | string | draft（待上传资料）/ pending_confirm（待确认）/ active / paused / completed / archived |
| conversationId | string | 来源会话（可选） |
| primaryMaterialId | string | 主资料 ID |
| cardsGeneratedUnits | number[] | 已出卡的周次，如 `[1, 2]` |
| confirmedAt | Date | 用户确认计划时间 |
| createdAt | Date | |
| updatedAt | Date | |

主流程：对话创建 `draft` → 上传主资料生成周安排并置 `pending_confirm` → 用户确认后 `active` 并生成第 1 周卡片。

## knowledge_cards

| 字段 | 类型 | 说明 |
|------|------|------|
| _id | string | |
| userId | string | |
| planId | string | 所属计划 |
| topic | string | 知识点，如「多线程」 |
| question | string | 正面（问题） |
| answer | string | 背面（答案要点） |
| source | string | plan / material |
| week | number | 所属周次（资料出卡时） |
| easeFactor | number | SM-2 难度因子，默认 2.5 |
| interval | number | 间隔天数 |
| repetitions | number | 连续正确次数 |
| nextReviewAt | Date | 下次复习时间 |
| lastReviewAt | Date | 上次复习 |
| status | string | active / mastered / suspended |

## materials

| 字段 | 类型 | 说明 |
|------|------|------|
| _id | string | |
| userId | string | |
| planId | string | |
| title | string | |
| type | string | text / pdf / file |
| content | string | 抽检后文本（限长） |
| fileID | string | 云存储（PDF） |
| cardCount | number | 该资料关联出卡数（主资料上传时为 0） |
| isPrimary | boolean | 是否主资料 |
| createdAt | Date | |

## review_logs

| 字段 | 类型 | 说明 |
|------|------|------|
| _id | string | |
| userId | string | |
| cardId | string | |
| quality | number | 0-5，自评或判分 |
| userAnswer | string | 用户回答（可选） |
| createdAt | Date | |

## ai_call_logs

AI 调用审计日志（合规留存，默认 180 天；与 `review_logs` 分离）。

| 字段 | 类型 | 说明 |
|------|------|------|
| userId | string | 内部用户 |
| openid | string | 微信 openid |
| scene | string | chat / plan / material |
| model | string | 模型名；mock 时为 `mock` |
| prompt | string | 用户输入/目标（限长） |
| response | string | AI 返回全文（限长） |
| ok | boolean | 是否成功 |
| error | string | 失败原因摘要 |
| createdAt | Date | 调用时间 |
| expireAt | Date | createdAt + 180 天，便于日后清理 |

定时清理：云函数 `cleanupAiLogs`（每天 03:00，`expireAt < now` 分批删除，单次最多 1000 条）。  
建议索引：`expireAt` 升序。

## 建议索引

- `users.openid` 唯一
- `knowledge_cards`: `userId + nextReviewAt`
- `study_plans`: `userId + status`
- `conversations`: `userId + updatedAt`
- `ai_call_logs`: `userId + createdAt`；**`expireAt`（清理用）**
