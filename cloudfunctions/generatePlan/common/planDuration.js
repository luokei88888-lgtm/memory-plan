/**
 * 从用户目标文案推断计划周数。
 * 支持：N周 / N个月 / N天 / 一个月 / 两周 等常见说法。
 */
function inferWeekCount(text, fallback = 4) {
  const s = String(text || '');
  const cnMap = { 半: 0.5, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

  let weeks = null;

  // N 周 / N个周
  let m = s.match(/(\d+)\s*周/);
  if (m) weeks = Number(m[1]);

  if (weeks == null) {
    m = s.match(/([一二两三四五六七八九十半])\s*周/);
    if (m && cnMap[m[1]] != null) weeks = Math.max(1, Math.round(cnMap[m[1]]));
  }

  // N 个月 / N月
  if (weeks == null) {
    m = s.match(/(\d+)\s*个?月/);
    if (m) weeks = Number(m[1]) * 4;
  }
  if (weeks == null) {
    m = s.match(/([一二两三四五六七八九十半])\s*个?月/);
    if (m && cnMap[m[1]] != null) weeks = Math.max(1, Math.round(cnMap[m[1]] * 4));
  }

  // N 天
  if (weeks == null) {
    m = s.match(/(\d+)\s*天/);
    if (m) weeks = Math.max(1, Math.ceil(Number(m[1]) / 7));
  }

  if (weeks == null || !Number.isFinite(weeks) || weeks <= 0) {
    weeks = fallback;
  }

  return weeks;
}

/** 限制在产品允许区间内 */
function clampWeekCount(n, min = 1, max = 24) {
  const v = Math.round(Number(n) || min);
  return Math.min(max, Math.max(min, v));
}

module.exports = { inferWeekCount, clampWeekCount };
