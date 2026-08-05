const cloud = require('wx-server-sdk');
const { ensureUser, quotaView } = require('./common');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async () => {
  const { userId, openid, user } = await ensureUser(cloud, db);
  return {
    userId,
    openid,
    ...quotaView(user),
    remindEnabled: !!user.remindEnabled
  };
};
