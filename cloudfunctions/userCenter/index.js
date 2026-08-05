const cloud = require('wx-server-sdk');
const {
  ensureUser,
  quotaView,
  grantAdReward,
  grantShareReward,
  grantInviteReward,
  buildReport,
  COLLECTIONS,
  ERROR
} = require('./common');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const { action = 'profile', enabled, inviterId } = event;
  const { userId, user } = await ensureUser(cloud, db);

  if (action === 'profile') {
    return {
      ...quotaView(user),
      remindEnabled: !!user.remindEnabled,
      inviteCount: user.inviteCount || 0
    };
  }

  if (action === 'report') {
    const report = await buildReport(db, userId);
    return { ok: true, report, ...quotaView(user) };
  }

  if (action === 'claimAdReward') {
    return grantAdReward(db, userId, user);
  }

  if (action === 'claimShareReward') {
    return grantShareReward(db, userId, user);
  }

  if (action === 'claimInviteReward') {
    return grantInviteReward(db, userId, user, inviterId);
  }

  if (action === 'setRemind') {
    const remindEnabled = !!enabled;
    await db.collection(COLLECTIONS.USERS).doc(userId).update({
      data: { remindEnabled, updatedAt: new Date() }
    });
    return { ok: true, remindEnabled, ...quotaView(user) };
  }

  return { error: ERROR.UNKNOWN_ACTION };
};
