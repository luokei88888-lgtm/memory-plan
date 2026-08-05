# M2 配置说明：额度 / 广告 / 订阅消息

## 0. 上线开关

当前产品阶段默认**不拦截额度、不展示广告/提醒入口**。  
上线前将 `cloudfunctions/common/constants.js` 中：

```js
ENFORCE_QUOTA: true
```

并恢复「我的」页额度/广告/订阅 UI 即可。

## 1. 每日额度（已实现）

- 默认每天 `20` 次 AI 对话（`common/constants.js` → `DAILY_QUOTA`）
- 每天最多生成 `10` 次学习计划（`MAX_PLAN_GEN_PER_DAY`），前端直连或经 `chat` 触发统一计数，防绕过刷量
- 看广告每次 `+5`（`AD_REWARD_QUOTA`），每天最多领 `5` 次（`MAX_AD_CLAIMS_PER_DAY`）
- 分享裂变：见 `docs/m2-share.md`（分享得次数 + 邀请奖励）
- 「我的」页展示剩余次数；用尽后对话页会引导看广告
- 上述限制均随 `ENFORCE_QUOTA=true` 生效（当前默认关闭，便于联调）

## 2. 激励视频广告

1. 微信公众平台 → 流量主 → 广告管理 → 新建 **激励式视频** 广告位  
2. 复制广告位 ID，填到：

```js
// miniprogram/utils/constants.js
AD_UNIT_ID: 'adunit-xxxxxxxx'
```

未配置时：开发联调可点「直接领取」发放次数（方便测试）。上线前务必配置真实广告位。

## 3. 订阅消息提醒

1. 公众平台 → 功能 → 订阅消息 → 选用学习/提醒类公共模板  
2. 模板 ID 填入：

```js
// miniprogram/utils/constants.js
SUBSCRIBE_TMPL_IDS: ['模板ID']
```

3. 云函数 `sendRemind` 配置环境变量：

| 变量 | 说明 |
|------|------|
| `SUBSCRIBE_TMPL_ID` | 与上面模板 ID 一致 |

4. 按你的模板字段，修改 `cloudfunctions/sendRemind/index.js` 里的 `data` 字段名（thing1/thing2/time3 等需与模板一致）  
5. 为 `sendRemind` 添加定时触发器，例如每天 20:00：`0 0 20 * * * *`  
6. 用户在「我的 → 复习提醒」授权后，`remindEnabled` 才会为 true  

## 4. 需重新部署的云函数

改完 common 后先执行：

```bash
node scripts/install-functions.js
```

然后上传：`login`、`chat`、`getToday`、`userCenter`、`sendRemind`、`cleanupAiLogs`（以及依赖 common 的其他函数建议一并更新）。

## 5. AI 日志定时清理

1. 云数据库创建集合 `ai_call_logs`，建议索引：`expireAt` 升序  
2. 上传并部署云函数 `cleanupAiLogs`（`config.json` 已声明每天 03:00 定时触发：`0 0 3 * * * *`）  
3. 在云开发控制台核对触发器是否生效；可手动「测试」云函数确认返回 `{ ok, deleted }`  
4. 日志写入保留 180 天（`expireAt`）；清理只删到期文档，不会提前删
