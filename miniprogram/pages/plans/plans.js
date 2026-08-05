const api = require('../../utils/api');
const { PLAN_STATUS_LABEL } = require('../../utils/constants');
const { syncPageTheme } = require('../../utils/theme');

Page({
  data: {
    themeMode: 'light',
    isDark: false,
    scope: 'home',
    loading: true,
    plans: [],
    emptyText: ''
  },

  onShow() {
    syncPageTheme(this);
    this.load();
  },

  switchScope(e) {
    const scope = e.currentTarget.dataset.scope;
    if (scope === this.data.scope) return;
    this.setData({ scope });
    this.load();
  },

  async load() {
    this.setData({ loading: true });
    try {
      await getApp().ensureLogin();
      const res = await api.getPlans(this.data.scope);
      const plans = (res.plans || []).map((p) => ({
        ...p,
        statusLabel: PLAN_STATUS_LABEL[p.status] || p.status || '进行中'
      }));
      this.setData({
        plans,
        emptyText:
          this.data.scope === 'archived' ? '还没有归档的计划' : '还没有进行中的计划',
        loading: false
      });
    } catch (e) {
      console.error(e);
      this.setData({ loading: false, plans: [] });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  goPlan(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/plan/plan?id=${id}` });
  },

  goChat() {
    wx.switchTab({ url: '/pages/chat/chat' });
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  }
});
