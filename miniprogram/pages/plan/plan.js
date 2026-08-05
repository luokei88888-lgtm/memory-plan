const api = require('../../utils/api');
const { PLAN_STATUS, PLAN_STATUS_LABEL, AI_DISCLAIMER } = require('../../utils/constants');
const { syncPageTheme } = require('../../utils/theme');

Page({
  data: {
    themeMode: 'light',
    isDark: false,
    aiDisclaimer: AI_DISCLAIMER,
    planId: '',
    plan: null,
    cards: [],
    materials: [],
    loading: true,
    confirming: false,
    generatingWeek: false,
    tab: 'weeks',
    statusLabel: '',
    isDraft: false,
    isPendingConfirm: false,
    isActive: false,
    isPaused: false,
    isArchived: false,
    canManage: false,
    canUpload: false,
    canConfirm: false,
    canReview: false,
    canBuildPlan: false,
    buildingPlan: false,
    nextWeekToGenerate: 0,
    canGenerateNextWeek: false
  },

  onLoad(query) {
    this.setData({ planId: query.id || '' });
  },

  onShow() {
    syncPageTheme(this);
    if (this.data.planId) this.load();
  },

  applyPlan(plan, cards, materials) {
    const status = (plan && plan.status) || PLAN_STATUS.ACTIVE;
    const weeks = (plan && plan.weeks) || [];
    const done = (plan && plan.cardsGeneratedUnits) || [];
    let nextWeek = 0;
    for (let i = 0; i < weeks.length; i += 1) {
      const w = Number(weeks[i].week) || i + 1;
      if (done.indexOf(w) < 0) {
        nextWeek = w;
        break;
      }
    }

    this.setData({
      plan,
      cards: cards || [],
      materials: materials || [],
      statusLabel: PLAN_STATUS_LABEL[status] || status,
      isDraft: status === PLAN_STATUS.DRAFT,
      isPendingConfirm: status === PLAN_STATUS.PENDING_CONFIRM,
      isActive: status === PLAN_STATUS.ACTIVE,
      isPaused: status === PLAN_STATUS.PAUSED,
      isArchived: status === PLAN_STATUS.ARCHIVED || status === PLAN_STATUS.COMPLETED,
      canManage: true,
      canUpload: status === PLAN_STATUS.DRAFT || status === PLAN_STATUS.ACTIVE,
      canConfirm: status === PLAN_STATUS.PENDING_CONFIRM,
      canReview: status === PLAN_STATUS.ACTIVE && (cards || []).length > 0,
      canBuildPlan: status === PLAN_STATUS.DRAFT && (materials || []).length > 0,
      nextWeekToGenerate: nextWeek,
      canGenerateNextWeek: status === PLAN_STATUS.ACTIVE && nextWeek > 0,
      loading: false
    });
  },

  async load() {
    if (!this.data.planId) {
      this.setData({ loading: false });
      return;
    }
    this.setData({ loading: true });
    try {
      const [res, mat] = await Promise.all([
        api.getPlanDetail(this.data.planId),
        api.listMaterials(this.data.planId).catch(() => ({ materials: [] }))
      ]);
      if (!res.plan) {
        this.setData({ plan: null, loading: false });
        return;
      }
      this.applyPlan(res.plan, res.cards, mat.materials);
    } catch (e) {
      console.error(e);
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  switchTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab });
  },

  goMaterial() {
    if (!this.data.canUpload) {
      wx.showToast({
        title: this.data.isPendingConfirm ? '请先确认计划' : '当前不可上传',
        icon: 'none'
      });
      return;
    }
    const mode = this.data.isDraft ? 'primary' : 'append';
    wx.navigateTo({
      url: `/pages/material/material?planId=${this.data.planId}&mode=${mode}`
    });
  },

  goReview() {
    if (!this.data.canReview) {
      wx.showToast({ title: '请先确认计划并生成卡片', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/review/review' });
  },

  async onBuildPlan() {
    if (!this.data.canBuildPlan || this.data.buildingPlan) return;
    this.setData({ buildingPlan: true });
    wx.showLoading({ title: '正在生成计划…', mask: true });
    try {
      const primary = (this.data.materials || []).find((m) => m.isPrimary) || this.data.materials[0];
      const res = await api.buildPlanFromMaterial({
        planId: this.data.planId,
        materialId: primary && primary._id
      });
      wx.hideLoading();
      this.setData({ buildingPlan: false });
      if (!res.ok) {
        wx.showToast({ title: res.message || '生成失败', icon: 'none' });
        return;
      }
      wx.showToast({ title: '计划已生成', icon: 'success' });
      this.load();
    } catch (e) {
      wx.hideLoading();
      this.setData({ buildingPlan: false });
      console.error(e);
      wx.showToast({ title: '生成失败', icon: 'none' });
    }
  },

  async onConfirmPlan() {
    if (!this.data.canConfirm || this.data.confirming) return;
    this.setData({ confirming: true });
    wx.showLoading({ title: '确认并生成卡片…', mask: true });
    try {
      const res = await api.confirmPlan(this.data.planId);
      wx.hideLoading();
      this.setData({ confirming: false });
      if (res.error && !res.confirmed) {
        wx.showToast({ title: res.message || '确认失败', icon: 'none' });
        return;
      }
      const n = res.cardCount || 0;
      wx.showModal({
        title: '计划已确认',
        content:
          n > 0
            ? `已生成第 1 周 ${n} 张复习卡片，可以开始复习。`
            : res.message || '计划已确认。若卡片未生成，可稍后在「怎么考」中重试。',
        showCancel: false,
        success: () => this.load()
      });
    } catch (e) {
      wx.hideLoading();
      this.setData({ confirming: false });
      console.error(e);
      wx.showToast({ title: '确认失败', icon: 'none' });
    }
  },

  async onGenerateNextWeek() {
    const week = this.data.nextWeekToGenerate;
    if (!week || this.data.generatingWeek) return;
    this.setData({ generatingWeek: true });
    wx.showLoading({ title: `生成第${week}周卡片…`, mask: true });
    try {
      const res = await api.generateUnitCards(this.data.planId, week);
      wx.hideLoading();
      this.setData({ generatingWeek: false });
      if (res.error) {
        wx.showToast({ title: res.message || '生成失败', icon: 'none' });
        return;
      }
      wx.showToast({ title: `已生成 ${res.cardCount || 0} 张`, icon: 'success' });
      this.load();
    } catch (e) {
      wx.hideLoading();
      this.setData({ generatingWeek: false });
      console.error(e);
      wx.showToast({ title: '生成失败', icon: 'none' });
    }
  },

  async runManage(op, confirm) {
    if (confirm) {
      const ok = await new Promise((resolve) => {
        wx.showModal({
          title: confirm.title,
          content: confirm.content,
          confirmColor: confirm.danger ? '#C96B5B' : '#2F6F6A',
          success: (r) => resolve(!!r.confirm)
        });
      });
      if (!ok) return;
    }

    wx.showLoading({ title: '处理中', mask: true });
    try {
      const res = await api.managePlan(this.data.planId, op);
      wx.hideLoading();
      if (res.error) {
        wx.showToast({ title: res.message || '操作失败', icon: 'none' });
        return;
      }
      if (op === 'delete') {
        wx.showToast({ title: '已删除', icon: 'success' });
        setTimeout(() => {
          wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/home/home' }) });
        }, 400);
        return;
      }
      wx.showToast({ title: '已更新', icon: 'success' });
      this.load();
    } catch (e) {
      wx.hideLoading();
      console.error(e);
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  onPause() {
    this.runManage('pause', {
      title: '暂停计划',
      content: '暂停后该计划的卡片不再出现在今日复习，可随时恢复。'
    });
  },

  onResume() {
    this.runManage('resume');
  },

  onArchive() {
    this.runManage('archive', {
      title: '归档计划',
      content: '归档后从进行中列表移出，卡片不再复习。可在「我的计划」里恢复。'
    });
  },

  onDelete() {
    this.runManage('delete', {
      title: '删除计划',
      content: '将永久删除该计划及其卡片、资料和复习记录，不可恢复。',
      danger: true
    });
  }
});
