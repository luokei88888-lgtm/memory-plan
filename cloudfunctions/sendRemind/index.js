/**
 * 定时触发器云函数：扫描明日有待复习且开启提醒的用户，发送订阅消息。
 *
 * 部署后请在云开发控制台为此函数添加「定时触发器」，例如每天 20:00：
 *   0 0 20 * * * *
 *
 * 环境变量：
 *   SUBSCRIBE_TMPL_ID = 微信公众平台申请的订阅消息模板 ID
 */
const cloud = require('wx-server-sdk');
const { COLLECTIONS, CARD_STATUS } = require('./common');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const PAGE_SIZE = 100;
const MAX_PAGES = 100; // 安全上限：最多 1 万用户/次，避免异常时长时间运行

/** 计算「后天 0 点（东八区）」对应的真实 UTC 时间，作为待复习截止 */
function endOfTomorrowUTC8() {
  const now = new Date();
  const utc8 = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const y = utc8.getUTCFullYear();
  const m = utc8.getUTCMonth();
  const d = utc8.getUTCDate();
  // 后天 00:00（东八区）= 该日 UTC 时间戳 - 8 小时
  return new Date(Date.UTC(y, m, d + 2, 0, 0, 0) - 8 * 60 * 60 * 1000);
}

/** 用户是否有「明日前到期」或「从未复习」的卡片 */
async function hasDueCard(userId, end) {
  const dueRes = await db
    .collection(COLLECTIONS.KNOWLEDGE_CARDS)
    .where({
      userId,
      status: _.neq(CARD_STATUS.SUSPENDED),
      nextReviewAt: _.lt(end)
    })
    .limit(1)
    .get()
    .catch(() => ({ data: [] }));
  if (dueRes.data && dueRes.data.length > 0) return true;

  const neverRes = await db
    .collection(COLLECTIONS.KNOWLEDGE_CARDS)
    .where({
      userId,
      status: _.neq(CARD_STATUS.SUSPENDED),
      lastReviewAt: _.eq(null)
    })
    .limit(1)
    .get()
    .catch(() => ({ data: [] }));
  return !!(neverRes.data && neverRes.data.length > 0);
}

exports.main = async () => {
  const tmplId = process.env.SUBSCRIBE_TMPL_ID || '';
  if (!tmplId) {
    console.warn('[sendRemind] 未配置 SUBSCRIBE_TMPL_ID，跳过发送');
    return { skipped: true, reason: 'missing tmpl id' };
  }

  const end = endOfTomorrowUTC8();
  let scanned = 0;
  let sent = 0;
  let failed = 0;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const usersRes = await db
      .collection(COLLECTIONS.USERS)
      .where({ remindEnabled: true })
      .skip(page * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .get()
      .catch(() => ({ data: [] }));

    const users = usersRes.data || [];
    if (!users.length) break;
    scanned += users.length;

    for (const user of users) {
      if (!user.openid) continue;
      let due = false;
      try {
        due = await hasDueCard(user._id, end);
      } catch (e) {
        console.error('[sendRemind] due check fail', user._id, e);
      }
      if (!due) continue;

      try {
        await cloud.openapi.subscribeMessage.send({
          touser: user.openid,
          templateId: tmplId,
          page: 'pages/home/home',
          data: {
            thing1: { value: '忆习复习提醒' },
            thing2: { value: '你有卡片待复习，回来巩固一下吧' },
            time3: { value: new Date().toLocaleString('zh-CN', { hour12: false }).slice(0, 16) }
          }
        });
        sent += 1;
      } catch (e) {
        console.error('[sendRemind] send fail', user._id, e);
        failed += 1;
      }
    }

    if (users.length < PAGE_SIZE) break;
  }

  return { scanned, sent, failed };
};
