const api = require('../../utils/api');
const { buildInvitePath, claimShareRewardQuiet } = require('../../utils/share');
const { SHARE_REWARD_QUOTA, MAX_SHARE_CLAIMS_PER_DAY } = require('../../utils/constants');
const { syncPageTheme, setTheme } = require('../../utils/theme');

Page({
  data: {
    themeMode: 'light',
    isDark: false,
    tips: [
      '主动回忆比反复看更有效',
      '答错没关系，系统会缩短间隔多帮你复习',
      '每天坚持一点，比突击更稳'
    ],
    shareHint: `分享给好友可 +${SHARE_REWARD_QUOTA} 次对话`,
    shareText: '我在用忆习做 AI 学习计划 + 遗忘曲线复习，一起坚持吧'
  },

  onShow() {
    syncPageTheme(this);
    this.refreshShareHint();
  },

  onThemeSwitch(e) {
    const on = !!(e.detail && e.detail.value);
    const themeMode = setTheme(on ? 'dark' : 'light');
    this.setData({
      themeMode,
      isDark: themeMode === 'dark'
    });
  },

  async refreshShareHint() {
    try {
      await getApp().ensureLogin();
      const res = await api.getProfile();
      const left = Math.max(
        0,
        (res.shareClaimsMax || MAX_SHARE_CLAIMS_PER_DAY) - (res.shareClaimsToday || 0)
      );
      const shareHint =
        res.canShareReward === false
          ? '今日分享奖励已领完'
          : `每次 +${res.shareRewardQuota || SHARE_REWARD_QUOTA}，今日还可领 ${left} 次`;
      this.setData({ shareHint });
    } catch (e) {
      console.warn(e);
    }
  },

  goPlans() {
    wx.navigateTo({ url: '/pages/plans/plans' });
  },

  goReport() {
    wx.navigateTo({ url: '/pages/report/report' });
  },

  onShareAppMessage() {
    claimShareRewardQuiet().then(() => this.refreshShareHint());
    return {
      title: this.data.shareText,
      path: buildInvitePath('/pages/home/home'),
      imageUrl: '/images/logo.jpg'
    };
  },

  openSubscribe() {
    wx.showToast({
      title: '提醒功能上线前再开放',
      icon: 'none'
    });
  }
});
