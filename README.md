# 忆习 · AI 学习计划 + 遗忘曲线巩固

微信小程序（原生）+ 微信云开发。通过 AI 对话制定学习计划，自动生成记忆卡片，按艾宾浩斯遗忘曲线主动复习。

## MVP 闭环

```
对话 → 生成学习计划 → 生成记忆卡片 → 按曲线出题复习 → 订阅消息提醒
```

## 技术栈

| 层 | 方案 |
|----|------|
| 前端 | 微信原生小程序 |
| 后端 | 微信云开发（云函数 Node.js） |
| 数据库 | 云数据库（文档型） |
| AI | 可切换（默认 DeepSeek，封装在 `cloudfunctions/common/ai.js`） |

## 目录结构

```
memory-plan/
├── miniprogram/              # 小程序前端
│   ├── pages/               # home / chat / plan / review / me
│   └── utils/
│       ├── api.js           # 云函数调用封装（不传 userId）
│       └── constants.js     # 场景、遗忘曲线常量
├── cloudfunctions/          # 云函数
│   ├── common/              # 公共包 mp-common（各函数 file: 依赖，一处维护）
│   │   ├── constants.js     # 集合名 / 枚举 / 默认值 / 错误码
│   │   ├── auth.js          # ensureUser：由 OPENID 反查身份（安全核心）
│   │   ├── ai.js            # 大模型统一调用 + JSON 解析
│   │   ├── srs.js           # SM-2 遗忘曲线算法
│   │   ├── plan.js          # 计划 + 卡片落库
│   │   ├── conversation.js  # 会话追加写（限长）
│   │   └── mock.js          # 无 Key 兜底计划
│   ├── login/               # 登录：ensureUser
│   ├── chat/                # 对话（可触发生成计划）
│   ├── generatePlan/        # 生成计划 + 卡片
│   ├── getToday/            # 今日待复习 / 计划列表 / 计划详情
│   └── review/              # 拉取题目 / 提交答案 / 更新间隔
├── scripts/
│   └── install-functions.js # 一键为所有云函数安装依赖
└── docs/
    ├── architecture.md      # 架构说明
    ├── data-model.md        # 数据模型
    └── setup.md             # 云开发部署清单
```

## 工程规范

- 身份安全：前端不传 `userId`，云函数内经 `OPENID` 反查（`common/auth.js`）
- 代码复用：共享逻辑集中在 `mp-common`，各函数 `file:../common` 引用
- 代码风格：`ESLint` + `Prettier`（`npm run lint` / `npm run format`）

## 本地运行

1. 用微信开发者工具打开本项目根目录
2. 填写自己的 `appid`（`project.config.json`）
3. 开通云开发，创建环境，把环境 ID 填到 `miniprogram/app.js`
4. 右键 `cloudfunctions` 下各函数 → 上传并部署（安装依赖）
5. 在云开发控制台创建集合：`users` / `conversations` / `study_plans` / `knowledge_cards` / `review_logs`
6. 在云函数环境变量中配置 `AI_API_KEY`（DeepSeek 等）

## 当前进度与后续

- **已完成（可验证 MVP）**：对话 → 计划/卡片 → 资料出题 → 复习 SRS → 报告 → 分享裂变 → 计划管理  
- **M2（代码已有、默认关闭）**：额度 / 广告 / 订阅，上线前再开（`docs/m2-setup.md`）  
- **完整商业版路线图**（测试体验之后按阶段推进）：见 **[docs/commercial-roadmap.md](docs/commercial-roadmap.md)**  
- 代码审查与自测清单：`docs/review.md`

## 文档

| 文档 | 说明 |
|------|------|
| [docs/commercial-roadmap.md](docs/commercial-roadmap.md) | 完整商业版方案与分阶段路线图 |
| [docs/architecture.md](docs/architecture.md) | 技术架构 |
| [docs/data-model.md](docs/data-model.md) | 数据模型 |
| [docs/setup.md](docs/setup.md) | 云开发部署 |
| [docs/m2-setup.md](docs/m2-setup.md) | 额度 / 广告 / 订阅 |
| [docs/m2-share.md](docs/m2-share.md) | 分享裂变 |
| [docs/m3-material.md](docs/m3-material.md) | 资料出题 |
| [docs/m4-report.md](docs/m4-report.md) | 学习报告 |
| [docs/review.md](docs/review.md) | 审查记录与回归清单 |
