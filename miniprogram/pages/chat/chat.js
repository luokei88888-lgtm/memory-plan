const api = require('../../utils/api');
const { SCENES, AI_DISCLAIMER } = require('../../utils/constants');
const { syncPageTheme } = require('../../utils/theme');

const QUICK_PROMPTS = SCENES.map((s) => ({
  title: s.title,
  prompt: s.prompt,
  tone: s.tone || 'teal'
}));

Page({
  data: {
    themeMode: 'light',
    isDark: false,
    aiDisclaimer: AI_DISCLAIMER,
    messages: [],
    input: '',
    canSend: false,
    sending: false,
    conversationId: '',
    scrollIntoView: '',
    showWelcome: true,
    quickPrompts: QUICK_PROMPTS,
    dailyQuota: null
  },

  onShow() {
    syncPageTheme(this);
    const preset = wx.getStorageSync('chatPreset');
    if (preset && preset.prompt) {
      wx.removeStorageSync('chatPreset');
      this.setData({
        input: preset.prompt,
        canSend: !!String(preset.prompt).trim()
      });
    }
  },

  onInput(e) {
    const input = e.detail.value || '';
    this.setData({
      input,
      canSend: !!input.trim() && !this.data.sending
    });
  },

  onQuickTap(e) {
    const prompt = e.currentTarget.dataset.prompt || '';
    if (!prompt || this.data.sending) return;
    this.setData({ input: prompt, canSend: true }, () => {
      this.onSend();
    });
  },

  async onSend() {
    const text = (this.data.input || '').trim();
    if (!text || this.data.sending) return;

    const userMsg = { role: 'user', content: text };
    const baseHistory = this.data.messages.length
      ? this.data.messages
      : [{ role: 'assistant', content: '你好，我是忆习助手，可以帮你制定学习计划。' }];
    const messages = baseHistory.concat(userMsg);

    this.setData({
      messages,
      showWelcome: false,
      input: '',
      canSend: false,
      sending: true,
      scrollIntoView: `msg-${messages.length - 1}`
    });

    try {
      const res = await api.chat({
        conversationId: this.data.conversationId,
        message: text,
        history: messages.slice(-12)
      });

      if (res.error === 'CONTENT_RISKY') {
        wx.showToast({ title: '内容未通过安全检测', icon: 'none' });
      }

      const next = messages.concat({
        role: 'assistant',
        content: res.reply || '我这边暂时没想好，请再描述一下你的目标。',
        planId: res.planId || '',
        needUpload: !!res.needUpload
      });

      this.setData({
        messages: next,
        conversationId: res.conversationId || this.data.conversationId,
        sending: false,
        scrollIntoView: `msg-${next.length - 1}`
      });
    } catch (e) {
      console.error(e);
      const next = messages.concat({
        role: 'assistant',
        content: '网络或 AI 服务暂时不可用，请稍后再试。'
      });
      this.setData({
        messages: next,
        sending: false,
        scrollIntoView: `msg-${next.length - 1}`
      });
    }
  },

  openPlan(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: `/pages/plan/plan?id=${id}` });
  },

  openUpload(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({
      url: `/pages/material/material?planId=${id}&mode=primary`
    });
  }
});
