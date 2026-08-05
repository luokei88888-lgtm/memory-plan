const { COLLECTIONS, CARD_STATUS } = require('./constants');

/**
 * 判断卡片是否到期应复习：
 * - 从未复习过（lastReviewAt 为空）→ 立即复习
 * - 或 nextReviewAt <= now
 */
function isCardDue(card, now = new Date()) {
  if (!card || card.status === CARD_STATUS.SUSPENDED) return false;
  if (!card.lastReviewAt) return true;
  if (!card.nextReviewAt) return true;
  return new Date(card.nextReviewAt) <= now;
}

/**
 * 拉取用户待复习卡片（含从未复习过的新卡片）
 */
async function loadDueCards(db, userId, limit = 20) {
  const now = new Date();
  const res = await db.collection(COLLECTIONS.KNOWLEDGE_CARDS).where({ userId }).limit(100).get();
  return (res.data || []).filter((c) => isCardDue(c, now)).slice(0, limit);
}

module.exports = { isCardDue, loadDueCards };
