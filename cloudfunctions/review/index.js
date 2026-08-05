const cloud = require('wx-server-sdk');
const {
  ensureUser,
  schedule,
  loadDueCards,
  checkTextSafe,
  SAFE_REPLY,
  COLLECTIONS,
  ERROR
} = require('./common');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const { action = 'start', cardId, quality, userAnswer } = event;
  const { userId, openid } = await ensureUser(cloud, db);

  if (action === 'start') {
    const cards = await loadDueCards(db, userId, 20);
    return { cards };
  }

  if (action === 'submit') {
    const q = Number(quality);
    if (!cardId || !Number.isFinite(q) || q < 0 || q > 5) {
      return { error: ERROR.MISSING_PARAM };
    }
    const cardRes = await db
      .collection(COLLECTIONS.KNOWLEDGE_CARDS)
      .doc(cardId)
      .get()
      .catch(() => null);
    const card = cardRes && cardRes.data;
    if (!card || card.userId !== userId) {
      return { error: ERROR.NOT_FOUND };
    }

    let safeAnswer = (userAnswer || '').slice(0, 2000);
    if (safeAnswer.trim()) {
      const ansCheck = await checkTextSafe(cloud, { openid, content: safeAnswer, scene: 2 });
      if (!ansCheck.ok) {
        return { error: ERROR.CONTENT_RISKY, message: SAFE_REPLY.USER_INPUT };
      }
    }

    const next = schedule(card, q);
    await db.collection(COLLECTIONS.KNOWLEDGE_CARDS).doc(cardId).update({
      data: {
        easeFactor: next.easeFactor,
        interval: next.interval,
        repetitions: next.repetitions,
        nextReviewAt: next.nextReviewAt,
        lastReviewAt: next.lastReviewAt,
        status: next.status
      }
    });

    await db.collection(COLLECTIONS.REVIEW_LOGS).add({
      data: {
        userId,
        cardId,
        quality: q,
        userAnswer: safeAnswer,
        createdAt: new Date()
      }
    });

    return { ok: true, nextReviewAt: next.nextReviewAt, interval: next.interval };
  }

  return { error: ERROR.UNKNOWN_ACTION };
};
