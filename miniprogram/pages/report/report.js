const api = require('../../utils/api');
const { buildInvitePath, claimShareRewardQuiet } = require('../../utils/share');
const { syncPageTheme } = require('../../utils/theme');

const SERIES = [
  { key: 'count', label: '复习次数', color: '#5B6B7A', dashed: true },
  { key: 'forgot', label: '忘了', color: '#D45B4A' },
  { key: 'fuzzy', label: '模糊', color: '#E0B33C' },
  { key: 'remembered', label: '记住了', color: '#2FA36B' }
];

const SERIES_DARK = [
  { key: 'count', label: '复习次数', color: '#9AA8B4', dashed: true },
  { key: 'forgot', label: '忘了', color: '#E08A7C' },
  { key: 'fuzzy', label: '模糊', color: '#E0C06A' },
  { key: 'remembered', label: '记住了', color: '#5CB890' }
];

Page({
  data: {
    loading: true,
    themeMode: 'light',
    isDark: false,
    report: null,
    shareText: '',
    dateLabel: '',
    streakDesc: '',
    statusPill: '',
    chartWidth: 300,
    chartHeight: 200,
    chartSeries: SERIES,
    chartTip: {
      show: false,
      left: 0,
      day: '',
      count: 0,
      forgot: 0,
      fuzzy: 0,
      remembered: 0
    }
  },

  onShow() {
    syncPageTheme(this);
    const isDark = this.data.isDark;
    this.setData({ chartSeries: isDark ? SERIES_DARK : SERIES });
    this.load();
  },

  async load() {
    this.setData({
      loading: true,
      chartTip: {
        show: false,
        left: 0,
        day: '',
        count: 0,
        forgot: 0,
        fuzzy: 0,
        remembered: 0
      }
    });
    try {
      await getApp().ensureLogin();
      const res = await api.getReport();
      const report = res.report || null;
      const now = new Date();
      const dateLabel = `${now.getMonth() + 1}月${now.getDate()}日`;
      const streak = (report && report.streak) || 0;
      const due = (report && report.dueCount) || 0;
      const todayDone = (report && report.todayReviewCount) || 0;
      let statusPill = '今日待开启';
      if (todayDone > 0 && due === 0) statusPill = '今日已完成';
      else if (due > 0) statusPill = `待复习 ${due}`;
      else if (streak > 0) statusPill = '节奏保持中';

      const streakDesc =
        streak > 0 ? '坚持比突击更重要，继续保持节奏' : '坚持从今天开始，记录每一次进步';

      const shareText = report
        ? `我在忆习已连续学习 ${report.streak} 天，累计复习 ${report.totalReviewCount} 次，掌握率 ${report.masteryRate}%`
        : '我在用忆习做 AI 学习计划 + 遗忘曲线复习';
      this.setData(
        {
          report,
          shareText,
          dateLabel,
          streakDesc,
          statusPill,
          loading: false
        },
        () => {
          if (report && report.weekBars) {
            setTimeout(() => this.drawWeekChart(report.weekBars), 50);
          }
        }
      );
    } catch (e) {
      console.error(e);
      this.setData({ loading: false, report: null });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  drawWeekChart(weekBars) {
    const bars = weekBars || [];
    if (!bars.length) return;

    const query = wx.createSelectorQuery().in(this);
    query
      .select('.chart-wrap')
      .boundingClientRect((rect) => {
        if (!rect || !rect.width) return;
        const width = Math.floor(rect.width);
        const height = 200;
        this.setData({ chartWidth: width, chartHeight: height }, () => {
          this._paintWeekChart(bars, width, height);
        });
      })
      .exec();
  },

  _paintWeekChart(bars, width, height) {
    const PAD = { top: 16, right: 12, bottom: 36, left: 36 };
    const ctx = wx.createCanvasContext('weekChart', this);
    const { top, right, bottom, left } = PAD;
    const plotW = width - left - right;
    const plotH = height - top - bottom;
    const maxVal = Math.max(
      1,
      ...bars.map((b) =>
        Math.max(
          Number(b.count) || 0,
          Number(b.forgot) || 0,
          Number(b.fuzzy) || 0,
          Number(b.remembered) || 0
        )
      )
    );
    const yMax = niceCeil(maxVal);
    const n = bars.length;
    const stepX = n > 1 ? plotW / (n - 1) : 0;

    const dayPoints = bars.map((b, i) => {
      const x = left + (n > 1 ? i * stepX : plotW / 2);
      return {
        x,
        day: b.day,
        count: Number(b.count) || 0,
        forgot: Number(b.forgot) || 0,
        fuzzy: Number(b.fuzzy) || 0,
        remembered: Number(b.remembered) || 0
      };
    });

    ctx.setFillStyle(this.data.isDark ? '#1a2634' : '#ffffff');
    ctx.fillRect(0, 0, width, height);

    const ticks = 4;
    ctx.setStrokeStyle(this.data.isDark ? '#2a3544' : '#e8eef2');
    ctx.setLineDash([4, 4], 0);
    ctx.setLineWidth(1);
    ctx.setFillStyle('#9aa8b4');
    ctx.setFontSize(10);
    ctx.setTextAlign('right');
    for (let t = 0; t <= ticks; t += 1) {
      const ratio = t / ticks;
      const y = top + plotH * (1 - ratio);
      const val = Math.round(yMax * ratio);
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + plotW, y);
      ctx.stroke();
      ctx.fillText(String(val), left - 6, y + 3);
    }
    ctx.setLineDash([], 0);

    SERIES.forEach((series) => {
      const points = dayPoints.map((d) => {
        const v = d[series.key];
        const y = top + plotH - (v / yMax) * plotH;
        return { x: d.x, y, v };
      });

      ctx.beginPath();
      points.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      if (series.dashed) ctx.setLineDash([6, 4], 0);
      else ctx.setLineDash([], 0);
      ctx.setStrokeStyle(series.color);
      ctx.setLineWidth(series.dashed ? 2 : 2.5);
      ctx.setLineJoin('round');
      ctx.setLineCap('round');
      ctx.stroke();
      ctx.setLineDash([], 0);

      // 仅在有数据的点画圆点，避免四条线叠在 0 轴上看不见
      points.forEach((p) => {
        if (!p.v) return;
        ctx.beginPath();
        ctx.arc(p.x, p.y, series.dashed ? 3 : 3.5, 0, Math.PI * 2);
        ctx.setFillStyle('#ffffff');
        ctx.fill();
        ctx.setStrokeStyle(series.color);
        ctx.setLineWidth(2);
        ctx.stroke();
      });
    });

    ctx.setFillStyle('#9aa8b4');
    ctx.setFontSize(10);
    ctx.setTextAlign('center');
    dayPoints.forEach((p) => {
      ctx.fillText(p.day || '', p.x, height - 10);
    });

    ctx.draw();
    this._chartPoints = dayPoints;
  },

  onChartTouch(e) {
    const touch = e.touches && e.touches[0];
    const points = this._chartPoints;
    if (!touch || !points || !points.length) return;

    const x = touch.x;
    let best = points[0];
    let bestDist = Math.abs(points[0].x - x);
    points.forEach((p) => {
      const d = Math.abs(p.x - x);
      if (d < bestDist) {
        best = p;
        bestDist = d;
      }
    });

    const tipW = 128;
    let left = best.x - tipW / 2;
    const width = this.data.chartWidth || 300;
    left = Math.max(8, Math.min(left, width - tipW - 8));

    this.setData({
      chartTip: {
        show: true,
        left,
        day: best.day,
        count: best.count,
        forgot: best.forgot,
        fuzzy: best.fuzzy,
        remembered: best.remembered
      }
    });
  },

  goReview() {
    wx.navigateTo({ url: '/pages/review/review' });
  },

  onShareAppMessage() {
    claimShareRewardQuiet();
    return {
      title: this.data.shareText || '忆习 · AI 学习计划与复习',
      path: buildInvitePath('/pages/home/home')
    };
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  }
});

function niceCeil(n) {
  if (n <= 5) return 5;
  if (n <= 10) return 10;
  if (n <= 20) return 20;
  if (n <= 50) return 50;
  const p = 10 ** Math.floor(Math.log10(n));
  return Math.ceil(n / p) * p;
}
