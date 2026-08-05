# 分享裂变与额度

## 规则（服务端）

| 动作 | 奖励 | 限制 |
|------|------|------|
| 分享给好友 | 分享人 +3 次对话 | 每天最多 3 次（打开分享面板即计，靠日限防刷） |
| 好友点开分享进入 | 邀请人 +5、受邀人 +3 | 每人一生仅绑定一次邀请；禁止自己邀请自己 |

常量在 `cloudfunctions/common/constants.js`：
`SHARE_REWARD_QUOTA` / `MAX_SHARE_CLAIMS_PER_DAY` / `INVITE_REWARD_QUOTA` / `INVITEE_WELCOME_QUOTA`

## 接口

`userCenter`：
- `claimShareReward`
- `claimInviteReward`（参数 `inviterId`，服务端校验归属与是否已绑定）

## 前端入口

- 我的 →「分享得次数」
- 学习报告 →「分享得对话次数」
- 今日页右上角菜单分享也会带邀请参数并发分享奖励

分享 path：`/pages/home/home?inviter=<邀请人 userId>`

## 部署

```bash
node scripts/install-functions.js
```

上传部署 **`userCenter`**（以及同步过 common 的相关函数建议一并更新）。

说明：额度奖励会写入 `dailyQuota`；当前若 `ENFORCE_QUOTA=false`，次数不拦截对话，但仍会累加，便于上线打开开关后直接生效。
