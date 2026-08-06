const api = require('./utils/api');
const { getTheme, applyChrome } = require('./utils/theme');

App({
  globalData: {
    userId: null,
    openid: null,
    cloudEnv: '',
    loginReady: null,
    themeMode: 'light'
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 及以上基础库以使用云能力');
      return;
    }

    const env = this.globalData.cloudEnv;
    wx.cloud.init({
      ...(env ? { env } : {}),
      traceUser: true
    });

    const themeMode = getTheme();
    this.globalData.themeMode = themeMode;
    applyChrome(themeMode);

    this.globalData.loginReady = this.login();
  },

  async login() {
    try {
      const res = await api.login();
      const { userId, openid } = res || {};
      this.globalData.userId = userId;
      this.globalData.openid = openid;
      wx.setStorageSync('userId', userId);
      wx.setStorageSync('openid', openid);
      console.log('[app] login ok', userId);
      return res;
    } catch (e) {
      console.error('[app] 登录失败:', e);
      const localUserId = wx.getStorageSync('userId');
      if (localUserId) this.globalData.userId = localUserId;
      // 不向外抛，避免未捕获的 Promise 在控制台刷 Error: timeout
      return null;
    }
  },

  async ensureLogin() {
    if (!this.globalData.loginReady) {
      this.globalData.loginReady = this.login();
    }
    await this.globalData.loginReady;
  },

  getUserId() {
    return this.globalData.userId || wx.getStorageSync('userId');
  }
});
