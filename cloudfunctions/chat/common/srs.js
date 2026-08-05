const { CARD_STATUS } = require('./constants');

/**
 * 简化版 SM-2（艾宾浩斯间隔重复）
 * quality: 0-5；<3 视为未记住，重置间隔。
 * 下次复习时间 = 当前时间 + interval 天（不用 setHours，避免云函数 UTC 时区偏差）。
 */
function schedule(card, quality) {
  let { easeFactor = 2.5, interval = 0, repetitions = 0 } = card || {};
  const q = Math.max(0, Math.min(5, Number(quality) || 0));

  if (q < 3) {
    repetitions = 0;
    interval = 1;
  } else {
    if (repetitions === 0) interval = 1;
    else if (repetitions === 1) interval = 3;
    else interval = Math.round(interval * easeFactor);

    repetitions += 1;
    easeFactor = Math.max(1.3, easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  }

  const nextReviewAt = new Date(Date.now() + interval * 24 * 60 * 60 * 1000);

  return {
    easeFactor: Number(easeFactor.toFixed(2)),
    interval,
    repetitions,
    nextReviewAt,
    lastReviewAt: new Date(),
    status: repetitions >= 6 && interval >= 30 ? CARD_STATUS.MASTERED : CARD_STATUS.ACTIVE
  };
}

module.exports = { schedule };
