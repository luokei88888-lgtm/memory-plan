const api = require('../../utils/api');

// 与云端一致：单文件建议 ≤50MB；更大需拆章。云端会按前/中/后抽页，不必整本解析
const MAX_PDF_BYTES = 50 * 1024 * 1024;

Page({
  data: {
    planId: '',
    mode: 'append',
    isPrimary: false,
    title: '',
    content: '',
    submitting: false,
    canSubmit: false,
    pdfName: '',
    introText: '',
    submitLabel: ''
  },

  onLoad(query) {
    const mode = query.mode === 'primary' ? 'primary' : 'append';
    const isPrimary = mode === 'primary';
    this.setData({
      planId: query.planId || '',
      mode,
      isPrimary,
      introText: isPrimary
        ? '支持粘贴文字，或选择 PDF / txt / md（单文件约 50MB 内）。大 PDF 会智能抽取前/中/后内容来制定计划，确认后再出复习卡片。'
        : '支持粘贴文字，或选择 PDF / txt / md（单文件约 50MB 内）。大 PDF 会智能抽取前/中/后内容生成复习卡片。',
      submitLabel: isPrimary ? '用上方文字生成计划' : '用上方文字生成卡片'
    });
    if (!query.planId) {
      wx.showToast({ title: '缺少计划 ID', icon: 'none' });
    }
    wx.setNavigationBarTitle({
      title: isPrimary ? '上传主资料' : '添加资料'
    });
  },

  onTitleInput(e) {
    this.setData({ title: e.detail.value || '' });
  },

  onContentInput(e) {
    const content = e.detail.value || '';
    this.setData({
      content,
      canSubmit: content.trim().length >= 20 && !this.data.submitting
    });
  },

  chooseFile() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['pdf', 'txt', 'md'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file) return;
        const name = file.name || '';
        const lower = name.toLowerCase();

        if (lower.endsWith('.pdf')) {
          this.handlePdf(file);
          return;
        }

        if (lower.endsWith('.txt') || lower.endsWith('.md')) {
          this.handleTextFile(file);
          return;
        }

        wx.showToast({ title: '仅支持 pdf / txt / md', icon: 'none' });
      }
    });
  },

  handleTextFile(file) {
    const fs = wx.getFileSystemManager();
    fs.readFile({
      filePath: file.path,
      encoding: 'utf-8',
      success: (r) => {
        const content = String(r.data || '').trim();
        if (content.length < 20) {
          wx.showToast({ title: '文件内容太短', icon: 'none' });
          return;
        }
        const name = (file.name || '').replace(/\.(txt|md)$/i, '');
        this.setData({
          content,
          pdfName: '',
          title: this.data.title || name || '上传资料',
          canSubmit: true
        });
        wx.showToast({ title: '已读入文本', icon: 'success' });
      },
      fail: () => wx.showToast({ title: '读取文件失败', icon: 'none' })
    });
  },

  finishSuccess(res) {
    const isPrimary = this.data.isPrimary || res.primary || res.planGenerated;
    if (isPrimary) {
      wx.showModal({
        title: '计划已生成',
        content: '已根据资料生成学习计划，请确认后开始生成复习卡片。',
        showCancel: false,
        success: () => {
          wx.redirectTo({
            url: `/pages/plan/plan?id=${this.data.planId}`
          });
        }
      });
      return;
    }

    wx.showModal({
      title: '生成成功',
      content: `已从资料生成 ${res.cardCount || 0} 张记忆卡片，可立即复习。`,
      showCancel: false,
      success: () => wx.navigateBack()
    });
  },

  /** 主资料：先落库，再单独请求生成计划，避免一次云函数超时 */
  async maybeBuildPlan(res) {
    if (!res || !res.needBuildPlan) return res;
    wx.showLoading({ title: '正在生成计划…', mask: true });
    const planRes = await api.buildPlanFromMaterial({
      planId: this.data.planId,
      materialId: res.materialId
    });
    if (!planRes.ok) {
      const err = new Error(planRes.message || planRes.error || '计划生成失败');
      err.materialId = res.materialId;
      err.planRes = planRes;
      throw err;
    }
    return { ...res, ...planRes, planGenerated: true };
  },

  async handlePdf(file) {
    if (file.size && file.size > MAX_PDF_BYTES) {
      wx.showToast({ title: 'PDF 请小于 50MB，更大请按章节拆分', icon: 'none', duration: 3500 });
      return;
    }

    if (!this.data.planId) {
      wx.showToast({ title: '缺少计划', icon: 'none' });
      return;
    }

    const name = (file.name || '资料').replace(/\.pdf$/i, '');
    this.setData({
      submitting: true,
      canSubmit: false,
      pdfName: file.name || 'document.pdf',
      title: this.data.title || name
    });
    wx.showLoading({ title: '上传并解析 PDF…', mask: true });

    try {
      const cloudPath = `materials/${this.data.planId}/${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}.pdf`;
      const up = await wx.cloud.uploadFile({
        cloudPath,
        filePath: file.path
      });

      let res = await api.createMaterialFromPdf({
        planId: this.data.planId,
        title: (this.data.title || name || 'PDF 资料').trim(),
        fileID: up.fileID
      });

      if (!res.ok) {
        wx.hideLoading();
        this.setData({ submitting: false, canSubmit: !!this.data.content.trim() });
        wx.showToast({ title: res.message || 'PDF 处理失败', icon: 'none', duration: 3000 });
        return;
      }

      res = await this.maybeBuildPlan(res);
      wx.hideLoading();
      this.finishSuccess(res);
    } catch (e) {
      wx.hideLoading();
      console.error(e);
      this.setData({ submitting: false, canSubmit: !!this.data.content.trim() });
      const msg =
        (e && e.planRes && e.planRes.message) ||
        (e && e.message) ||
        'PDF 处理失败';
      if (e && e.materialId) {
        wx.showModal({
          title: '资料已保存',
          content: `${msg}\n可返回计划页重试，或换更小的 PDF / 粘贴正文。`,
          showCancel: false,
          success: () => {
            wx.redirectTo({ url: `/pages/plan/plan?id=${this.data.planId}` });
          }
        });
        return;
      }
      wx.showToast({
        title: /timeout|504003|TIME_LIMIT/i.test(String(msg))
          ? '处理超时，请换更小 PDF 或粘贴正文'
          : 'PDF 处理失败',
        icon: 'none',
        duration: 3000
      });
    }
  },

  async onSubmit() {
    const content = (this.data.content || '').trim();
    if (!this.data.planId) {
      wx.showToast({ title: '缺少计划', icon: 'none' });
      return;
    }
    if (content.length < 20) {
      wx.showToast({ title: '请至少输入 20 字，或选择 PDF', icon: 'none' });
      return;
    }
    if (this.data.submitting) return;

    this.setData({ submitting: true, canSubmit: false });
    wx.showLoading({
      title: this.data.isPrimary ? '正在保存资料…' : '正在生成卡片…',
      mask: true
    });

    try {
      let res = await api.createMaterialFromText({
        planId: this.data.planId,
        title: (this.data.title || '').trim() || '学习资料',
        content
      });
      if (!res.ok) {
        wx.hideLoading();
        wx.showToast({ title: res.message || '生成失败', icon: 'none', duration: 3000 });
        this.setData({ submitting: false, canSubmit: true });
        return;
      }

      res = await this.maybeBuildPlan(res);
      wx.hideLoading();
      this.finishSuccess(res);
    } catch (e) {
      wx.hideLoading();
      console.error(e);
      this.setData({ submitting: false, canSubmit: true });
      if (e && e.materialId) {
        wx.showModal({
          title: '资料已保存',
          content: (e.planRes && e.planRes.message) || e.message || '计划生成失败，请稍后在计划页重试',
          showCancel: false,
          success: () => {
            wx.redirectTo({ url: `/pages/plan/plan?id=${this.data.planId}` });
          }
        });
        return;
      }
      wx.showToast({ title: '生成失败，请重试', icon: 'none' });
    }
  }
});
