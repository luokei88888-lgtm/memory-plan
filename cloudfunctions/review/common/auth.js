const { COLLECTIONS, DEFAULTS } = require('./constants');

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * 由微信上下文的 OPENID 反查/创建用户，返回可信身份。
 * 关键安全点：userId 永远来自服务端 OPENID，绝不信任前端传参。
 * 同时做每日额度重置。
 */
async function ensureUser(cloud, db) {
  const ctx = cloud.getWXContext() || {};
  // 小程序直调有 OPENID；跨账号等场景可能只有 FROM_OPENID
  const OPENID = ctx.OPENID || ctx.FROM_OPENID;
  if (!OPENID) {
    throw new Error('无法获取 OPENID');
  }

  const now = new Date();
  const today = todayStr();
  const res = await db.collection(COLLECTIONS.USERS).where({ openid: OPENID }).get();

  if (res.data.length > 0) {
    const user = res.data[0];
    if (user.quotaDate !== today) {
      await db.collection(COLLECTIONS.USERS).doc(user._id).update({
        data: {
          dailyQuota: DEFAULTS.DAILY_QUOTA,
          quotaDate: today,
          adClaimsToday: 0,
          shareClaimsToday: 0,
          planGenToday: 0,
          updatedAt: now
        }
      });
      user.dailyQuota = DEFAULTS.DAILY_QUOTA;
      user.quotaDate = today;
      user.adClaimsToday = 0;
      user.shareClaimsToday = 0;
      user.planGenToday = 0;
    }
    return { userId: user._id, openid: OPENID, user };
  }

  const addRes = await db.collection(COLLECTIONS.USERS).add({
    data: {
      openid: OPENID,
      nickname: '忆习学员',
      avatarUrl: '',
      dailyQuota: DEFAULTS.DAILY_QUOTA,
      quotaDate: today,
      adClaimsToday: 0,
      shareClaimsToday: 0,
      planGenToday: 0,
      inviteCount: 0,
      invitedBy: '',
      remindEnabled: false,
      createdAt: now,
      updatedAt: now
    }
  });

  const user = {
    _id: addRes._id,
    openid: OPENID,
    dailyQuota: DEFAULTS.DAILY_QUOTA,
    quotaDate: today,
    adClaimsToday: 0,
    shareClaimsToday: 0,
    planGenToday: 0,
    inviteCount: 0,
    invitedBy: '',
    remindEnabled: false
  };
  return { userId: addRes._id, openid: OPENID, user };
}

module.exports = { ensureUser };
