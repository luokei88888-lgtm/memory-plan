const { COLLECTIONS, PLAN_STATUS, CARD_STATUS, ERROR } = require('./constants');

/** 批量写入记忆卡片（立即可复习） */
async function addCards(db, userId, planId, cards) {
  const now = new Date();
  const list = cards || [];
  await Promise.all(
    list.map((c) =>
      db.collection(COLLECTIONS.KNOWLEDGE_CARDS).add({
        data: {
          userId,
          planId,
          topic: c.topic || '知识点',
          question: c.question,
          answer: c.answer,
          source: c.source || 'plan',
          week: typeof c.week === 'number' ? c.week : 0,
          easeFactor: 2.5,
          interval: 0,
          repetitions: 0,
          nextReviewAt: now,
          lastReviewAt: null,
          status: CARD_STATUS.ACTIVE,
          createdAt: now
        }
      })
    )
  );
  return list.length;
}

/**
 * 对话摸清情况后创建草稿计划（无周安排、无卡片），等待上传主资料。
 */
async function createDraftPlan(db, userId, { goal, title, scene, conversationId } = {}) {
  const now = new Date();
  const addPlan = await db.collection(COLLECTIONS.STUDY_PLANS).add({
    data: {
      userId,
      title: title || '待完善的学习计划',
      goal: goal || '',
      scene: scene || 'skill',
      weeks: [],
      status: PLAN_STATUS.DRAFT,
      conversationId: conversationId || '',
      primaryMaterialId: '',
      cardsGeneratedUnits: [],
      confirmedAt: null,
      createdAt: now,
      updatedAt: now
    }
  });
  return { planId: addPlan._id };
}

/**
 * 用资料生成的周计划覆盖草稿（仍不出卡），状态改为待确认。
 */
async function applyMaterialPlan(db, planId, planData, { primaryMaterialId } = {}) {
  const now = new Date();
  await db.collection(COLLECTIONS.STUDY_PLANS).doc(planId).update({
    data: {
      title: planData.title || '学习计划',
      goal: planData.goal || '',
      scene: planData.scene || 'skill',
      weeks: planData.weeks || [],
      status: PLAN_STATUS.PENDING_CONFIRM,
      primaryMaterialId: primaryMaterialId || '',
      updatedAt: now
    }
  });
  return { planId, status: PLAN_STATUS.PENDING_CONFIRM };
}

/**
 * 落库一份学习计划及其记忆卡片（旧路径保留，新主流程勿用）。
 */
async function persistPlan(db, userId, planData) {
  const now = new Date();

  const addPlan = await db.collection(COLLECTIONS.STUDY_PLANS).add({
    data: {
      userId,
      title: planData.title || '学习计划',
      goal: planData.goal || '',
      scene: planData.scene || 'skill',
      weeks: planData.weeks || [],
      status: PLAN_STATUS.ACTIVE,
      primaryMaterialId: '',
      cardsGeneratedUnits: [],
      confirmedAt: now,
      createdAt: now,
      updatedAt: now
    }
  });

  const cardCount = await addCards(db, userId, addPlan._id, planData.cards || []);
  return { planId: addPlan._id, cardCount };
}

async function getOwnedPlan(db, userId, planId) {
  if (!planId) return null;
  const planRes = await db.collection(COLLECTIONS.STUDY_PLANS).doc(planId).get();
  const plan = planRes.data || null;
  if (!plan || plan.userId !== userId) return null;
  return plan;
}

/** 按计划批量改卡片状态（分页，避免一次超限） */
async function setCardsStatusByPlan(db, userId, planId, fromStatuses, toStatus) {
  const _ = db.command;
  const MAX = 100;
  let touched = 0;
  for (;;) {
    const res = await db
      .collection(COLLECTIONS.KNOWLEDGE_CARDS)
      .where({ userId, planId, status: _.in(fromStatuses) })
      .limit(MAX)
      .get();
    const docs = res.data || [];
    if (!docs.length) break;
    await Promise.all(
      docs.map((d) =>
        db.collection(COLLECTIONS.KNOWLEDGE_CARDS).doc(d._id).update({
          data: { status: toStatus }
        })
      )
    );
    touched += docs.length;
    if (docs.length < MAX) break;
  }
  return touched;
}

async function removeDocsByPlan(db, collection, userId, planId) {
  const MAX = 100;
  let removed = 0;
  const fileIDs = [];
  const ids = [];
  for (;;) {
    const res = await db.collection(collection).where({ userId, planId }).limit(MAX).get();
    const docs = res.data || [];
    if (!docs.length) break;
    docs.forEach((d) => {
      ids.push(d._id);
      if (d.fileID) fileIDs.push(d.fileID);
    });
    await Promise.all(docs.map((d) => db.collection(collection).doc(d._id).remove()));
    removed += docs.length;
    if (docs.length < MAX) break;
  }
  return { removed, fileIDs, ids };
}

/**
 * 按卡片 ID 删除复习日志（review_logs 无 planId，需经 cardId 关联）。
 * _.in 分批，避免一次条件过大。
 */
async function removeReviewLogsByCardIds(db, userId, cardIds) {
  if (!cardIds || !cardIds.length) return 0;
  const _ = db.command;
  const CHUNK = 10;
  const MAX = 100;
  let removed = 0;

  for (let i = 0; i < cardIds.length; i += CHUNK) {
    const chunk = cardIds.slice(i, i + CHUNK);
    for (;;) {
      const res = await db
        .collection(COLLECTIONS.REVIEW_LOGS)
        .where({ userId, cardId: _.in(chunk) })
        .limit(MAX)
        .get();
      const docs = res.data || [];
      if (!docs.length) break;
      await Promise.all(docs.map((d) => db.collection(COLLECTIONS.REVIEW_LOGS).doc(d._id).remove()));
      removed += docs.length;
      if (docs.length < MAX) break;
    }
  }
  return removed;
}

/**
 * 计划管理：pause / resume / archive / delete
 * 暂停/归档会挂起卡片；恢复会把挂起卡片改回 active；
 * 删除连带卡片、资料与对应复习日志，避免报告残留。
 */
async function managePlan(db, userId, planId, op, options = {}) {
  const plan = await getOwnedPlan(db, userId, planId);
  if (!plan) return { error: ERROR.NOT_FOUND };

  const now = new Date();
  const cloud = options.cloud;

  if (op === 'confirm') {
    if (plan.status !== PLAN_STATUS.PENDING_CONFIRM) {
      return { error: ERROR.INVALID_STATUS, message: '仅待确认的计划可确认' };
    }
    await db.collection(COLLECTIONS.STUDY_PLANS).doc(planId).update({
      data: {
        status: PLAN_STATUS.ACTIVE,
        confirmedAt: now,
        updatedAt: now
      }
    });
    return { ok: true, status: PLAN_STATUS.ACTIVE };
  }

  if (op === 'pause') {
    if (plan.status !== PLAN_STATUS.ACTIVE) {
      return { error: ERROR.INVALID_STATUS, message: '仅进行中的计划可暂停' };
    }
    await db.collection(COLLECTIONS.STUDY_PLANS).doc(planId).update({
      data: { status: PLAN_STATUS.PAUSED, updatedAt: now }
    });
    await setCardsStatusByPlan(db, userId, planId, [CARD_STATUS.ACTIVE], CARD_STATUS.SUSPENDED);
    return { ok: true, status: PLAN_STATUS.PAUSED };
  }

  if (op === 'resume') {
    if (plan.status !== PLAN_STATUS.PAUSED && plan.status !== PLAN_STATUS.ARCHIVED) {
      return { error: ERROR.INVALID_STATUS, message: '仅暂停或已归档的计划可恢复' };
    }
    await db.collection(COLLECTIONS.STUDY_PLANS).doc(planId).update({
      data: { status: PLAN_STATUS.ACTIVE, updatedAt: now }
    });
    await setCardsStatusByPlan(
      db,
      userId,
      planId,
      [CARD_STATUS.SUSPENDED],
      CARD_STATUS.ACTIVE
    );
    return { ok: true, status: PLAN_STATUS.ACTIVE };
  }

  if (op === 'archive') {
    if (plan.status === PLAN_STATUS.ARCHIVED) {
      return { ok: true, status: PLAN_STATUS.ARCHIVED };
    }
    if (plan.status === PLAN_STATUS.COMPLETED) {
      return { error: ERROR.INVALID_STATUS, message: '已完成计划无需再归档' };
    }
    if (plan.status === PLAN_STATUS.DRAFT || plan.status === PLAN_STATUS.PENDING_CONFIRM) {
      return { error: ERROR.INVALID_STATUS, message: '请先删除未完成的草稿，或确认后再归档' };
    }
    await db.collection(COLLECTIONS.STUDY_PLANS).doc(planId).update({
      data: { status: PLAN_STATUS.ARCHIVED, updatedAt: now }
    });
    await setCardsStatusByPlan(db, userId, planId, [CARD_STATUS.ACTIVE], CARD_STATUS.SUSPENDED);
    return { ok: true, status: PLAN_STATUS.ARCHIVED };
  }

  if (op === 'delete') {
    // 复习日志只有 cardId、没有 planId：先收集卡片 ID → 删日志 → 删卡片/资料/计划
    const allCardIds = [];
    for (let skip = 0; skip < 2000; skip += 100) {
      const res = await db
        .collection(COLLECTIONS.KNOWLEDGE_CARDS)
        .where({ userId, planId })
        .skip(skip)
        .limit(100)
        .get();
      const docs = res.data || [];
      if (!docs.length) break;
      docs.forEach((d) => allCardIds.push(d._id));
      if (docs.length < 100) break;
    }

    const removedLogs = await removeReviewLogsByCardIds(db, userId, allCardIds);
    const cards = await removeDocsByPlan(db, COLLECTIONS.KNOWLEDGE_CARDS, userId, planId);
    const materials = await removeDocsByPlan(db, COLLECTIONS.MATERIALS, userId, planId);
    await db.collection(COLLECTIONS.STUDY_PLANS).doc(planId).remove();

    if (cloud && materials.fileIDs.length) {
      try {
        await cloud.deleteFile({ fileList: materials.fileIDs.slice(0, 50) });
      } catch (e) {
        console.warn('[plan] deleteFile failed', e);
      }
    }

    return {
      ok: true,
      deleted: true,
      removedCards: cards.removed,
      removedMaterials: materials.removed,
      removedLogs
    };
  }

  return { error: ERROR.UNKNOWN_ACTION };
}

module.exports = {
  persistPlan,
  createDraftPlan,
  applyMaterialPlan,
  addCards,
  getOwnedPlan,
  managePlan
};
