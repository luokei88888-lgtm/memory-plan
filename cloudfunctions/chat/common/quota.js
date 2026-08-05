const { COLLECTIONS, DEFAULTS, ERROR } = require('./constants');

function quotaView(user) {
  const dailyQuota = typeof user.dailyQuota === 'number' ? user.dailyQuota : DEFAULTS.DAILY_QUOTA;
  const adClaimsToday = user.adClaimsToday || 0;
  const shareClaimsToday = user.shareClaimsToday || 0;
  return {
    dailyQuota,
    dailyQuotaMax: DEFAULTS.DAILY_QUOTA,
    adRewardQuota: DEFAULTS.AD_REWARD_QUOTA,
    adClaimsToday,
    adClaimsMax: DEFAULTS.MAX_AD_CLAIMS_PER_DAY,
    canWatchAd: adClaimsToday < DEFAULTS.MAX_AD_CLAIMS_PER_DAY,
    shareRewardQuota: DEFAULTS.SHARE_REWARD_QUOTA,
    shareClaimsToday,
    shareClaimsMax: DEFAULTS.MAX_SHARE_CLAIMS_PER_DAY,
    canShareReward: shareClaimsToday < DEFAULTS.MAX_SHARE_CLAIMS_PER_DAY,
    inviteRewardQuota: DEFAULTS.INVITE_REWARD_QUOTA,
    inviteeWelcomeQuota: DEFAULTS.INVITEE_WELCOME_QUOTA
  };
}

/** 原子更新后重新读取用户，返回准确额度视图 */
async function freshView(db, userId, fallback) {
  try {
    const res = await db.collection(COLLECTIONS.USERS).doc(userId).get();
    if (res && res.data) return quotaView(res.data);
  } catch (e) {
    console.warn('[quota] refresh view failed', e);
  }
  return quotaView(fallback || {});
}

/**
 * 消耗 1 次对话额度（原子扣减，避免并发重复扣/透支）。
 * 仅在 dailyQuota > 0 时扣减，扣不到即视为已用尽。
 */
async function consumeQuota(db, userId, user) {
  const _ = db.command;
  const res = await db
    .collection(COLLECTIONS.USERS)
    .where({ _id: userId, dailyQuota: _.gt(0) })
    .update({ data: { dailyQuota: _.inc(-1), updatedAt: new Date() } });

  if (!res.stats || res.stats.updated === 0) {
    return { ok: false, code: ERROR.QUOTA_EXCEEDED, ...quotaView({ ...user, dailyQuota: 0 }) };
  }

  const view = await freshView(db, userId, { ...user, dailyQuota: (user.dailyQuota || 1) - 1 });
  return { ok: true, dailyQuota: view.dailyQuota, ...view };
}

/**
 * 消耗一次「生成计划」额度（原子递增 + 每日上限守卫）。
 * 无论前端直连 generatePlan 还是经 chat 触发，都走同一计数，防绕过刷量。
 */
async function consumePlanGen(db, userId) {
  const _ = db.command;
  const res = await db
    .collection(COLLECTIONS.USERS)
    .where({ _id: userId, planGenToday: _.lt(DEFAULTS.MAX_PLAN_GEN_PER_DAY) })
    .update({ data: { planGenToday: _.inc(1), updatedAt: new Date() } });

  const ok = !!(res.stats && res.stats.updated > 0);
  return { ok, code: ok ? null : ERROR.PLAN_LIMIT };
}

/**
 * 看完激励广告后发放额度（原子递增 + 每日上限守卫，防并发重复领取）。
 */
async function grantAdReward(db, userId, user) {
  const _ = db.command;
  const res = await db
    .collection(COLLECTIONS.USERS)
    .where({ _id: userId, adClaimsToday: _.lt(DEFAULTS.MAX_AD_CLAIMS_PER_DAY) })
    .update({
      data: {
        dailyQuota: _.inc(DEFAULTS.AD_REWARD_QUOTA),
        adClaimsToday: _.inc(1),
        updatedAt: new Date()
      }
    });

  if (!res.stats || res.stats.updated === 0) {
    return { ok: false, error: ERROR.AD_LIMIT, ...(await freshView(db, userId, user)) };
  }

  return { ok: true, added: DEFAULTS.AD_REWARD_QUOTA, ...(await freshView(db, userId, user)) };
}

/**
 * 分享给好友后发放额度（原子递增 + 每日上限守卫）。
 * 微信无法可靠验证是否真正发出，靠每日限次防刷。
 */
async function grantShareReward(db, userId, user) {
  const _ = db.command;
  const res = await db
    .collection(COLLECTIONS.USERS)
    .where({ _id: userId, shareClaimsToday: _.lt(DEFAULTS.MAX_SHARE_CLAIMS_PER_DAY) })
    .update({
      data: {
        dailyQuota: _.inc(DEFAULTS.SHARE_REWARD_QUOTA),
        shareClaimsToday: _.inc(1),
        updatedAt: new Date()
      }
    });

  if (!res.stats || res.stats.updated === 0) {
    return { ok: false, error: ERROR.SHARE_LIMIT, ...(await freshView(db, userId, user)) };
  }

  return { ok: true, added: DEFAULTS.SHARE_REWARD_QUOTA, ...(await freshView(db, userId, user)) };
}

/**
 * 受邀用户首次绑定邀请关系：邀请人 + 受邀人各得额度。
 * inviterId 仅作邀请人文档 ID，是否生效以服务端校验为准。
 * 用「invitedBy 为空」作为原子守卫，保证一个受邀人只发放一次。
 */
async function grantInviteReward(db, userId, user, inviterId) {
  const _ = db.command;

  if (!inviterId || inviterId === userId) {
    return { ok: false, error: ERROR.INVITE_INVALID, message: '无效邀请' };
  }
  if (user.invitedBy) {
    return { ok: false, error: ERROR.INVITE_INVALID, message: '已绑定过邀请' };
  }

  let inviter;
  try {
    const inviterRes = await db.collection(COLLECTIONS.USERS).doc(inviterId).get();
    inviter = inviterRes && inviterRes.data;
  } catch (e) {
    inviter = null;
  }
  if (!inviter) {
    return { ok: false, error: ERROR.INVITE_INVALID, message: '邀请人不存在' };
  }

  const now = new Date();
  // 原子守卫：仅当 invitedBy 仍为空/不存在时绑定，防并发/重复领取
  const bind = await db
    .collection(COLLECTIONS.USERS)
    .where({ _id: userId, invitedBy: _.in(['', null]) })
    .update({
      data: {
        invitedBy: inviterId,
        invitedAt: now,
        dailyQuota: _.inc(DEFAULTS.INVITEE_WELCOME_QUOTA),
        updatedAt: now
      }
    });

  if (!bind.stats || bind.stats.updated === 0) {
    return { ok: false, error: ERROR.INVITE_INVALID, message: '已绑定过邀请' };
  }

  // 绑定成功后给邀请人加次数（原子递增）
  await db
    .collection(COLLECTIONS.USERS)
    .doc(inviterId)
    .update({
      data: {
        dailyQuota: _.inc(DEFAULTS.INVITE_REWARD_QUOTA),
        inviteCount: _.inc(1),
        updatedAt: now
      }
    })
    .catch((e) => console.warn('[quota] inviter reward failed', e));

  return {
    ok: true,
    added: DEFAULTS.INVITEE_WELCOME_QUOTA,
    inviterAdded: DEFAULTS.INVITE_REWARD_QUOTA,
    ...(await freshView(db, userId, user))
  };
}

module.exports = {
  quotaView,
  consumeQuota,
  consumePlanGen,
  grantAdReward,
  grantShareReward,
  grantInviteReward
};
