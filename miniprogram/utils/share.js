const api = require('./api');

/**
 * 带邀请参数的分享 path（邀请人 ID 仅用于裂变归因，发奖在服务端校验）。
 */
function buildInvitePath(basePath = '/pages/home/home') {
  const inviter = getApp().getUserId();
  if (!inviter) return basePath;
  const sep = basePath.indexOf('?') >= 0 ? '&' : '?';
  return `${basePath}${sep}inviter=${encodeURIComponent(inviter)}`;
}

/**
 * 分享成功面板打开后尝试领分享额度（微信无法保证一定发出，服务端按日限次）。
 */
async function claimShareRewardQuiet() {
  try {
    const res = await api.claimShareReward();
    if (res && res.ok) {
      wx.showToast({
        title: `分享成功，+${res.added} 次对话`,
        icon: 'none'
      });
      return res;
    }
    if (res && res.error === 'SHARE_LIMIT') {
      wx.showToast({ title: '今日分享奖励已领完', icon: 'none' });
    }
    return res;
  } catch (e) {
    console.warn('[share] claim failed', e);
    return null;
  }
}

/**
 * 受邀进入：绑定邀请并发欢迎额度（每人仅一次）。
 */
async function tryClaimInvite(inviterId) {
  if (!inviterId) return null;
  const self = getApp().getUserId();
  if (self && self === inviterId) return null;
  try {
    const res = await api.claimInviteReward(inviterId);
    if (res && res.ok) {
      wx.showToast({
        title: `欢迎加入，+${res.added} 次对话`,
        icon: 'none'
      });
    }
    return res;
  } catch (e) {
    console.warn('[share] invite claim failed', e);
    return null;
  }
}

module.exports = { buildInvitePath, claimShareRewardQuiet, tryClaimInvite };
