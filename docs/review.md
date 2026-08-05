# 代码审查记录

审查时间：2026-08-04  
范围：全仓云函数 `common` + 各入口、小程序前端关键路径  
目标：安全、健壮、可维护；上线前对照清单

## 结论

主闭环与分层基本合格：身份走 `OPENID`、公共逻辑集中在 `cloudfunctions/common`、前端统一 `utils/api.js`。  
审查中发现的**高/中**问题已修复并部署；剩余为**低**优先级，不阻塞联调与上线准备。

---

## 已修复（高 / 中）

### 1. 会话越权写入（IDOR）— 高

- **位置**：`cloudfunctions/common/conversation.js`
- **问题**：`appendMessages` 信任前端传入的 `conversationId`，未校验 `doc.userId === 当前用户`，可能覆盖他人会话。
- **修复**：仅本人会话可追加；不存在或非本人则新建会话。
- **部署**：`chat`（及依赖 common 的函数）

### 2. 额度 / 奖励并发竞态 — 高

- **位置**：`cloudfunctions/common/quota.js`
- **问题**：`consumeQuota`、广告/分享奖励为「读-改-写」，并发可透支额度或重复领奖。
- **修复**：`where` 条件 + `_.inc` 原子更新；邀请绑定以 `invitedBy` 为空作守卫。
- **部署**：`userCenter`、`chat` 等依赖 common 的函数

### 3. 复习提交参数校验 — 中

- **位置**：`cloudfunctions/review/index.js`
- **问题**：`quality` 非法时可能写成 `NaN`，污染 `review_logs` 与报告。
- **修复**：校验 `0–5` 有限数；`userAnswer` 截断 2000 字。
- **部署**：`review`

### 4. generatePlan 直连刷量 — 中

- **位置**：`cloudfunctions/generatePlan/index.js`、`common/quota.js`、`common/auth.js`
- **问题**：前端可直调 `generatePlan`，绕过对话额度，消耗 AI。
- **修复**：`planGenToday` + `consumePlanGen`（每日上限 `MAX_PLAN_GEN_PER_DAY`，默认 10）；随 `ENFORCE_QUOTA` 生效；`chat` 达上限时友好提示。
- **部署**：`generatePlan`、`chat`

### 5. sendRemind 漏扫与时区 — 中

- **位置**：`cloudfunctions/sendRemind/index.js`
- **问题**：只扫前 50 用户；`setHours` 在云端 UTC 下偏差约 8 小时。
- **修复**：分页遍历（每页 100，安全上限约 1 万/次）；按东八区计算「后天 0 点」截止窗；到期查询容错。
- **部署**：`sendRemind`

---

## 建议后续（低，非阻塞）

| 项 | 位置 | 说明 |
|----|------|------|
| 到期卡片查询 | `common/cards.js` `loadDueCards` | 先取 100 再过滤，卡片很多时可能漏卡；宜改库端 `nextReviewAt` 条件 |
| 额度重置时区 | `common/auth.js` `todayStr` | 按 UTC 日重置（约北京 08:00）；与报告 UTC+8 口径不一致时可统一 |
| 邀请链接 | `miniprogram/utils/share.js` | path 带用户 `_id`；介意可改邀请码 |
| 前端多余导出 | `api.generatePlan` | 前端未用；服务端已有上限，风险可控 |

---

## 上线前开关（M2）

见 `docs/m2-setup.md`、`docs/m2-share.md`：

1. `ENFORCE_QUOTA: true`（对话额度 + 计划生成上限一并生效）
2. 恢复「我的」额度 / 广告 UI（若仍隐藏）
3. 配置 `AD_UNIT_ID`、订阅模板与 `sendRemind` 定时触发器

---

## 部署备忘

改 `common` 后：

```bash
node scripts/install-functions.js
```

再上传受影响云函数。审查相关建议至少覆盖：

`chat` · `generatePlan` · `review` · `userCenter` · `sendRemind` · `getToday` · `material` · `login`

全量重传 8 个云函数最省事。

---

## 自测清单（真机）

- [ ] 对话 → 生成计划 → 今日待复习 → 自评提交
- [ ] 资料（文本 / PDF）出题
- [ ] 计划：暂停 / 恢复 / 归档 / 删除
- [ ] 学习报告 + 分享得次数（日限）
- [ ] 受邀进入（`?inviter=`）欢迎额度（一生一次）
- [ ]（打开 M2 后）额度用尽、广告领奖、计划生成上限提示
