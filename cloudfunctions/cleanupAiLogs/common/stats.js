const { COLLECTIONS, CARD_STATUS, PLAN_STATUS } = require('./constants');
const { loadDueCards } = require('./cards');

/** 按东八区取 YYYY-MM-DD */
function dayKey(date = new Date()) {
  const t = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return t.toISOString().slice(0, 10);
}

function startOfDayUTC8(date = new Date()) {
  const key = dayKey(date);
  return new Date(`${key}T00:00:00+08:00`);
}

/**
 * 可靠计数：优先 count；失败或异常时用 get 分页兜底（避免报告卡片/计划全变成 0）。
 */
async function countDocs(db, collection, where, label = collection) {
  try {
    const res = await db.collection(collection).where(where).count();
    if (res && typeof res.total === 'number') return res.total;
  } catch (e) {
    console.warn(`[stats] count 失败，改用 get 兜底: ${label}`, e && e.message ? e.message : e);
  }

  try {
    let total = 0;
    const pageSize = 100;
    const maxScan = 1000;
    for (let skip = 0; skip < maxScan; skip += pageSize) {
      const res = await db.collection(collection).where(where).skip(skip).limit(pageSize).get();
      const n = (res.data && res.data.length) || 0;
      total += n;
      if (n < pageSize) break;
    }
    return total;
  } catch (e2) {
    console.warn(`[stats] get 兜底也失败: ${label}`, e2 && e2.message ? e2.message : e2);
    return 0;
  }
}

/**
 * 今日复习进度（东八区）：
 * 已复习唯一卡片数 / (已复习唯一卡片 + 当前仍待复习)
 */
async function buildTodayProgress(db, userId, dueCount) {
  const _ = db.command;
  const today0 = startOfDayUTC8();
  let todayDone = 0;
  try {
    const res = await db
      .collection(COLLECTIONS.REVIEW_LOGS)
      .where({ userId, createdAt: _.gte(today0) })
      .limit(200)
      .get();
    const ids = new Set();
    (res.data || []).forEach((log) => {
      if (log.cardId) ids.add(log.cardId);
    });
    todayDone = ids.size;
  } catch (e) {
    console.warn('[stats] todayDone failed', e && e.message ? e.message : e);
    todayDone = 0;
  }

  const due = Math.max(0, Number(dueCount) || 0);
  const total = todayDone + due;
  const reviewProgress = total > 0 ? Math.round((todayDone / total) * 100) : 100;
  return { todayDone, dueCount: due, reviewProgress };
}

async function loadRecentLogs(db, userId) {
  try {
    const res = await db
      .collection(COLLECTIONS.REVIEW_LOGS)
      .where({ userId })
      .orderBy('createdAt', 'desc')
      .limit(200)
      .get();
    return res.data || [];
  } catch (e) {
    console.warn('[stats] orderBy logs failed, fallback', e && e.message ? e.message : e);
    const res = await db.collection(COLLECTIONS.REVIEW_LOGS).where({ userId }).limit(200).get();
    return (res.data || []).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }
}

/**
 * 汇总用户学习报告数据
 */
async function buildReport(db, userId) {
  const _ = db.command;
  const today0 = startOfDayUTC8();
  const today = dayKey();
  const now = new Date();

  // 进行中 = 进行中 + 已暂停（与首页「我的计划」口径一致）
  const activePlanWhere = {
    userId,
    status: _.in([PLAN_STATUS.ACTIVE, PLAN_STATUS.PAUSED])
  };

  const [planCount, cardTotal, masteredCount, todayReviewCount, totalReviewCount, logs, dueCards] =
    await Promise.all([
      countDocs(db, COLLECTIONS.STUDY_PLANS, activePlanWhere, 'plans.active'),
      countDocs(db, COLLECTIONS.KNOWLEDGE_CARDS, { userId }, 'cards.all'),
      countDocs(
        db,
        COLLECTIONS.KNOWLEDGE_CARDS,
        { userId, status: CARD_STATUS.MASTERED },
        'cards.mastered'
      ),
      countDocs(
        db,
        COLLECTIONS.REVIEW_LOGS,
        { userId, createdAt: _.gte(today0) },
        'logs.today'
      ),
      countDocs(db, COLLECTIONS.REVIEW_LOGS, { userId }, 'logs.all'),
      loadRecentLogs(db, userId),
      loadDueCards(db, userId, 100)
    ]);

  const weekKeys = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    weekKeys.push(dayKey(d));
  }
  const weekMap = {};
  weekKeys.forEach((k) => {
    weekMap[k] = { count: 0, forgot: 0, fuzzy: 0, remembered: 0 };
  });
  logs.forEach((log) => {
    if (!log.createdAt) return;
    const k = dayKey(new Date(log.createdAt));
    if (!weekMap[k]) return;
    weekMap[k].count += 1;
    const q = Number(log.quality);
    if (q < 3) weekMap[k].forgot += 1;
    else if (q < 5) weekMap[k].fuzzy += 1;
    else weekMap[k].remembered += 1;
  });
  const weekMax = Math.max(
    1,
    ...weekKeys.map((k) =>
      Math.max(weekMap[k].count, weekMap[k].forgot, weekMap[k].fuzzy, weekMap[k].remembered)
    )
  );
  const weekBars = weekKeys.map((k) => ({
    day: k.slice(5),
    count: weekMap[k].count,
    forgot: weekMap[k].forgot,
    fuzzy: weekMap[k].fuzzy,
    remembered: weekMap[k].remembered,
    percent: Math.round((weekMap[k].count / weekMax) * 100)
  }));

  const daySet = new Set(
    logs.map((l) => (l.createdAt ? dayKey(new Date(l.createdAt)) : '')).filter(Boolean)
  );
  let streak = 0;
  for (let i = 0; i < 60; i += 1) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const k = dayKey(d);
    if (daySet.has(k)) streak += 1;
    else if (i === 0) continue;
    else break;
  }

  // 回忆质量：近 7 天合计（与折线图口径一致）
  let forgot = 0;
  let fuzzy = 0;
  let remembered = 0;
  weekKeys.forEach((k) => {
    forgot += weekMap[k].forgot;
    fuzzy += weekMap[k].fuzzy;
    remembered += weekMap[k].remembered;
  });

  const masteryRate = cardTotal > 0 ? Math.round((masteredCount / cardTotal) * 100) : 0;

  return {
    today,
    todayReviewCount,
    totalReviewCount,
    dueCount: (dueCards && dueCards.length) || 0,
    cardTotal,
    masteredCount,
    masteryRate,
    planCount,
    streak,
    weekBars,
    quality: { forgot, fuzzy, remembered }
  };
}

module.exports = { buildReport, buildTodayProgress, dayKey, startOfDayUTC8, countDocs };
