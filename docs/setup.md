# 云开发配置清单

## 1. 创建集合

在云开发控制台 → 数据库，创建：

- `users`
- `conversations`
- `study_plans`
- `knowledge_cards`
- `review_logs`

权限设为「仅创建者可读写」即可；云函数使用管理员权限，不受此限。

## 2. 索引（推荐）

- `knowledge_cards`：`userId` 升序 + `nextReviewAt` 升序
- `study_plans`：`userId` 升序 + `createdAt` 降序

## 3. 公共代码 common（重要）

源码在 `cloudfunctions/common`。部署前用脚本**同步拷贝**到每个云函数目录下的 `./common`，
各函数用 `require('./common')` 引用（不走 node_modules 链接，避免上传后找不到模块）。

```bash
# 在项目根目录执行
node scripts/install-functions.js
```

改完 `cloudfunctions/common` 后，必须重新跑脚本再上传相关云函数。

## 4. 云函数环境变量

在 `chat`、`generatePlan` 配置：

| 变量 | 示例 | 说明 |
|------|------|------|
| AI_API_KEY | sk-xxx | DeepSeek / 通义等密钥 |
| AI_BASE_URL | https://api.deepseek.com/v1 | 兼容 OpenAI 协议的地址 |
| AI_MODEL | deepseek-chat | 模型名 |

未配置 `AI_API_KEY` 时，系统用演示计划兜底，便于先跑通流程。

## 5. 部署顺序

1. 填写 `miniprogram/app.js` 里的 `cloudEnv`
2. 填写 `project.config.json` 的 `appid`
3. 根目录执行 `node scripts/install-functions.js`
4. 依次右键上传：`login` → `getToday` → `review` → `generatePlan` → `chat`
5. 上传可选 **「上传并部署：云端安装依赖」**（现在只依赖 `wx-server-sdk`，云端可装）  
   或 **「所有文件」** 亦可。

## 6. 安全模型

- 前端调用云函数**不传 userId**。
- 每个云函数内通过 `cloud.getWXContext().OPENID` 反查用户身份（见 `common/auth.js` 的 `ensureUser`）。
- 访问 `study_plans` / `knowledge_cards` 前会校验 `userId` 归属，防止越权读写他人数据。

## 7. Node 版本

云函数选择 Node.js 16 或 18（全局 `fetch` 可用）。若选更低版本，需把 `common/ai.js` 的 `fetch` 换成 `axios`。
