const api = require('../../utils/api');
const { SCENES } = require('../../utils/constants');
const { tryClaimInvite, buildInvitePath, claimShareRewardQuiet } = require('../../utils/share');
const { syncPageTheme, toggleTheme, ringStyle } = require('../../utils/theme');

function formatGreeting() {
  const h = new Date().getHours();
  if (h < 12) return '早上好';
  if (h < 18) return '下午好';
  return '晚上好';
}

function formatDateLine() {
  const d = new Date();
  const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日 周${week} · 保持节奏，稳步进步`;
}

function buildPlanProgress(plan, cards) {
  if (!plan) {
    return {
      planProgress: 0,
      planWeekText: '',
      planDone: 0,
      planTotal: 0
    };
  }

  const list = cards || [];
  const planTotal = list.length;
  const planDone = list.filter((c) => c.lastReviewAt || c.status === 'mastered').length;
  const planProgress = planTotal > 0 ? Math.round((planDone / planTotal) * 100) : 0;

  const weeks = plan.weeks || [];
  const weekCount = weeks.length || 4;
  let currentWeek = 1;
  if (plan.createdAt) {
    const days = Math.max(0, (Date.now() - new Date(plan.createdAt).getTime()) / (24 * 60 * 60 * 1000));
    currentWeek = Math.min(weekCount, Math.max(1, Math.ceil(days / 7) || 1));
  }

  return {
    planProgress,
    planWeekText: `第${currentWeek}周 · 已完成 ${planDone} / ${planTotal || 0} 个学习任务`,
    planDone,
    planTotal
  };
}

Page({
  data: {
    loading: true,
    themeMode: 'light',
    isDark: false,
    greeting: '你好',
    dateLine: '',
    todayCount: 0,
    todayDone: 0,
    reviewProgress: 0,
    ringStyle: '',
    planCount: 0,
    plans: [],
    latestPlan: null,
    planProgress: 0,
    planWeekText: '',
    dailyQuota: null,
    scenes: SCENES
  },

  onLoad(query) {
    const inviter = (query && query.inviter) || '';
    if (inviter) {
      this._pendingInviter = inviter;
    }
  },

  onShow() {
    syncPageTheme(this);
    this.setData({
      greeting: formatGreeting(),
      dateLine: formatDateLine()
    });
    this.loadToday();
  },

  onToggleTheme() {
    const themeMode = toggleTheme();
    const isDark = themeMode === 'dark';
    this.setData({
      themeMode,
      isDark,
      ringStyle: ringStyle(this.data.reviewProgress, themeMode)
    });
    wx.showToast({
      title: isDark ? '已切换夜间模式' : '已切换白天模式',
      icon: 'none',
      duration: 1200
    });
  },

  async handleInvite() {
    if (!this._pendingInviter) return;
    const inviter = this._pendingInviter;
    this._pendingInviter = '';
    await tryClaimInvite(inviter);
  },

  async loadToday() {
    this.setData({ loading: true });
    try {
      await getApp().ensureLogin();
      await this.handleInvite();

      const res = await api.getToday();

      const plans = res.plans || [];
      const latestPlan = plans[0] || null;
      const todayCount = typeof res.dueCount === 'number' ? res.dueCount : (res.cards && res.cards.length) || 0;
      const todayDone = typeof res.todayDone === 'number' ? res.todayDone : 0;
      const reviewProgress =
        typeof res.reviewProgress === 'number'
          ? res.reviewProgress
          : todayDone + todayCount > 0
            ? Math.round((todayDone / (todayDone + todayCount)) * 100)
            : 100;

      let planMeta = buildPlanProgress(latestPlan, []);
      if (latestPlan && latestPlan._id) {
        try {
          const detail = await api.getPlanDetail(latestPlan._id);
          planMeta = buildPlanProgress(detail.plan || latestPlan, detail.cards || []);
        } catch (e) {
          console.warn('[home] plan detail', e);
        }
      }

      const themeMode = this.data.themeMode || 'light';
      this.setData({
        todayCount,
        todayDone,
        reviewProgress,
        ringStyle: ringStyle(reviewProgress, themeMode),
        planCount: plans.length,
        plans,
        latestPlan,
        planProgress: planMeta.planProgress,
        planWeekText: planMeta.planWeekText,
        dailyQuota: typeof res.dailyQuota === 'number' ? res.dailyQuota : null,
        loading: false
      });
    } catch (e) {
      console.error(e);
      const themeMode = this.data.themeMode || 'light';
      this.setData({
        loading: false,
        todayCount: 0,
        todayDone: 0,
        reviewProgress: 0,
        ringStyle: ringStyle(0, themeMode),
        plans: [],
        latestPlan: null,
        planProgress: 0,
        planWeekText: '',
        dailyQuota: null
      });
      wx.showToast({ title: '加载失败，请下拉重试', icon: 'none' });
    }
  },

  goReview() {
    if (this.data.todayCount <= 0) {
      wx.showToast({ title: '今天暂无待复习', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/review/review' });
  },

  goPlans() {
    wx.navigateTo({ url: '/pages/plans/plans' });
  },

  goChat(e) {
    const prompt = (e.currentTarget.dataset && e.currentTarget.dataset.prompt) || '';
    const scene = (e.currentTarget.dataset && e.currentTarget.dataset.scene) || '';
    if (prompt) {
      wx.setStorageSync('chatPreset', { prompt, scene });
    }
    wx.switchTab({ url: '/pages/chat/chat' });
  },

  goPlan(e) {
    const id = e.currentTarget.dataset.id || (this.data.latestPlan && this.data.latestPlan._id);
    if (!id) {
      this.goChat({});
      return;
    }
    wx.navigateTo({ url: `/pages/plan/plan?id=${id}` });
  },

  onShareAppMessage() {
    claimShareRewardQuiet();
    return {
      title: '忆习 · AI 学习计划 + 遗忘曲线复习',
      path: buildInvitePath('/pages/home/home'),
      imageUrl: '/images/logo.jpg'
    };
  },

  onPullDownRefresh() {
    this.loadToday().finally(() => wx.stopPullDownRefresh());
  }
});
