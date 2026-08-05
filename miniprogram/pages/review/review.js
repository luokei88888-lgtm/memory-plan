const api = require('../../utils/api');
const { AI_DISCLAIMER } = require('../../utils/constants');
const { syncPageTheme } = require('../../utils/theme');

Page({
  data: {
    themeMode: 'light',
    isDark: false,
    aiDisclaimer: AI_DISCLAIMER,
    cards: [],
    index: 0,
    current: null,
    answer: '',
    showAnswer: false,
    finished: false,
    reviewed: 0,
    loading: true,
    progressPercent: 0
  },

  onLoad() {
    this.start();
  },

  onShow() {
    syncPageTheme(this);
  },

  async start() {
    this.setData({ loading: true });
    try {
      const res = await api.startReview();
      const cards = res.cards || [];
      this.setData({
        cards,
        index: 0,
        current: cards[0] || null,
        answer: '',
        showAnswer: false,
        finished: cards.length === 0,
        reviewed: 0,
        loading: false,
        progressPercent: cards.length ? Math.round(100 / cards.length) : 0
      });
      if (cards.length === 0) {
        wx.showToast({ title: '今天没有待复习', icon: 'none' });
      }
    } catch (e) {
      console.error(e);
      this.setData({ loading: false, finished: true });
    }
  },

  reveal() {
    this.setData({ showAnswer: true });
  },

  async rate(e) {
    const quality = Number(e.currentTarget.dataset.q);
    const { current, index, cards, reviewed } = this.data;
    if (!current) return;

    try {
      const res = await api.submitReview({
        cardId: current._id,
        quality,
        userAnswer: ''
      });
      if (res && res.error === 'CONTENT_RISKY') {
        wx.showToast({ title: res.message || '内容未通过安全检测', icon: 'none' });
        return;
      }
    } catch (err) {
      console.error(err);
      wx.showToast({ title: '提交失败', icon: 'none' });
      return;
    }

    const nextIndex = index + 1;
    if (nextIndex >= cards.length) {
      this.setData({
        finished: true,
        reviewed: reviewed + 1,
        current: null
      });
      return;
    }

    this.setData({
      index: nextIndex,
      current: cards[nextIndex],
      answer: '',
      showAnswer: false,
      reviewed: reviewed + 1,
      progressPercent: Math.round(((nextIndex + 1) / cards.length) * 100)
    });
  },

  backHome() {
    wx.switchTab({ url: '/pages/home/home' });
  }
});
