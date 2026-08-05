const cloud = require('wx-server-sdk');
const {
  ensureUser,
  loadDueCards,
  quotaView,
  managePlan,
  buildTodayProgress,
  COLLECTIONS,
  PLAN_STATUS,
  ERROR
} = require('./common');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const HOME_STATUSES = [
  PLAN_STATUS.DRAFT,
  PLAN_STATUS.PENDING_CONFIRM,
  PLAN_STATUS.ACTIVE,
  PLAN_STATUS.PAUSED
].filter(Boolean);
const ARCHIVE_STATUSES = [PLAN_STATUS.ARCHIVED, PLAN_STATUS.COMPLETED];

async function listPlans(userId, scope = 'home') {
  const statuses = scope === 'archived' ? ARCHIVE_STATUSES : HOME_STATUSES;
  const statusSet = new Set(statuses);

  try {
    const res = await db
      .collection(COLLECTIONS.STUDY_PLANS)
      .where({ userId })
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();
    return (res.data || []).filter((p) => statusSet.has(p.status || PLAN_STATUS.ACTIVE));
  } catch (e) {
    const res = await db.collection(COLLECTIONS.STUDY_PLANS).where({ userId }).limit(50).get();
    return (res.data || [])
      .filter((p) => statusSet.has(p.status || PLAN_STATUS.ACTIVE))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }
}

exports.main = async (event) => {
  const { action = 'today', planId, op, scope } = event;
  const { userId, user } = await ensureUser(cloud, db);

  if (action === 'plans') {
    return { plans: await listPlans(userId, scope || 'home'), ...quotaView(user) };
  }

  if (action === 'planDetail') {
    if (!planId) return { error: ERROR.MISSING_PARAM };
    const planRes = await db.collection(COLLECTIONS.STUDY_PLANS).doc(planId).get();
    const plan = planRes.data || null;
    if (!plan || plan.userId !== userId) return { error: ERROR.NOT_FOUND };
    const cardsRes = await db
      .collection(COLLECTIONS.KNOWLEDGE_CARDS)
      .where({ userId, planId })
      .limit(100)
      .get();
    return { plan, cards: cardsRes.data || [] };
  }

  if (action === 'managePlan') {
    if (!planId || !op) return { error: ERROR.MISSING_PARAM };
    const result = await managePlan(db, userId, planId, op, { cloud });
    if (result.error) return result;
    return result;
  }

  const [cards, plans] = await Promise.all([loadDueCards(db, userId, 50), listPlans(userId, 'home')]);
  const dueCount = (cards && cards.length) || 0;
  const progress = await buildTodayProgress(db, userId, dueCount);

  return {
    cards,
    plans,
    todayDone: progress.todayDone,
    dueCount: progress.dueCount,
    reviewProgress: progress.reviewProgress,
    ...quotaView(user),
    remindEnabled: !!user.remindEnabled
  };
};
