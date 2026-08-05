const cloud = require('wx-server-sdk');
const {
  ensureUser,
  createMaterialAndCards,
  saveMaterialOnly,
  generatePlanFromMaterial,
  extractPdfText,
  getOwnedPlan,
  COLLECTIONS,
  PLAN_STATUS,
  ERROR
} = require('./common');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

async function assertPlanOwner(userId, planId) {
  const plan = await getOwnedPlan(db, userId, planId);
  return plan;
}

/** 草稿：只落库主资料，不出计划（避免与 PDF 解析叠在一次超时） */
async function handlePrimarySave(userId, plan, { title, content, fileID, type, openid }) {
  const saved = await saveMaterialOnly(db, {
    userId,
    planId: plan._id,
    title: title || plan.title || '学习资料',
    content,
    fileID: fileID || '',
    type: type || 'text',
    isPrimary: true,
    cloud,
    openid
  });

  return {
    ok: true,
    primary: true,
    planGenerated: false,
    needBuildPlan: true,
    materialId: saved.materialId,
    title: saved.title,
    cardCount: 0,
    planId: plan._id
  };
}

async function handleAppendUpload(userId, plan, { title, content, fileID, type, openid }) {
  const result = await createMaterialAndCards(db, {
    userId,
    planId: plan._id,
    title: title || plan.title || '学习资料',
    content,
    fileID: fileID || '',
    type: type || 'text',
    cloud,
    openid
  });
  return { ok: true, primary: false, planGenerated: false, needBuildPlan: false, ...result };
}

/**
 * 基于已保存的主资料生成周计划（独立调用，避免与 PDF 解析抢超时）。
 */
async function buildPlanFromSavedMaterial(userId, planId, materialId, openid) {
  const plan = await assertPlanOwner(userId, planId);
  if (!plan) return { error: ERROR.NOT_FOUND };
  if (plan.status !== PLAN_STATUS.DRAFT) {
    return { error: ERROR.INVALID_STATUS, message: '仅草稿计划可生成安排' };
  }

  let mat = null;
  if (materialId) {
    try {
      const res = await db.collection(COLLECTIONS.MATERIALS).doc(materialId).get();
      mat = res.data;
    } catch (e) {
      mat = null;
    }
  }
  if (!mat || mat.userId !== userId || mat.planId !== planId) {
    const list = await db
      .collection(COLLECTIONS.MATERIALS)
      .where({ userId, planId })
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get()
      .catch(async () => {
        const all = await db.collection(COLLECTIONS.MATERIALS).where({ userId, planId }).limit(20).get();
        const sorted = (all.data || []).sort(
          (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
        );
        return { data: sorted.slice(0, 1) };
      });
    mat = (list.data || [])[0] || null;
  }

  if (!mat || !mat.content) {
    return { error: ERROR.MISSING_PARAM, message: '请先上传学习资料' };
  }

  const planRes = await generatePlanFromMaterial(db, userId, {
    planId,
    materialText: mat.content,
    materialTitle: mat.title,
    materialId: mat._id,
    cloud,
    openid
  });

  if (planRes.error) {
    return {
      ok: false,
      error: planRes.error,
      message: planRes.message || '计划生成失败',
      materialId: mat._id
    };
  }

  return {
    ok: true,
    primary: true,
    planGenerated: true,
    needBuildPlan: false,
    status: planRes.status,
    materialId: mat._id,
    title: mat.title,
    cardCount: 0,
    planId
  };
}

exports.main = async (event) => {
  const { action = 'createFromText', planId, title, content, fileID, materialId } = event;
  const { userId, openid } = await ensureUser(cloud, db);

  if (action === 'list') {
    if (!planId) return { error: ERROR.MISSING_PARAM };
    const plan = await assertPlanOwner(userId, planId);
    if (!plan) return { error: ERROR.NOT_FOUND };

    const res = await db
      .collection(COLLECTIONS.MATERIALS)
      .where({ userId, planId })
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get()
      .catch(async () => {
        const all = await db.collection(COLLECTIONS.MATERIALS).where({ userId, planId }).limit(50).get();
        return {
          data: (all.data || []).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        };
      });

    return { materials: res.data || [] };
  }

  if (action === 'buildPlan') {
    if (!planId) return { error: ERROR.MISSING_PARAM };
    try {
      return await buildPlanFromSavedMaterial(userId, planId, materialId, openid);
    } catch (e) {
      console.error('[material] buildPlan', e);
      if (e && e.code === ERROR.CONTENT_RISKY) {
        return { error: ERROR.CONTENT_RISKY, message: e.message || '内容未通过安全检测' };
      }
      return { error: ERROR.INTERNAL, message: e.message || '计划生成失败' };
    }
  }

  if (action === 'createFromText') {
    if (!planId || !content) return { error: ERROR.MISSING_PARAM };
    const plan = await assertPlanOwner(userId, planId);
    if (!plan) return { error: ERROR.NOT_FOUND };

    try {
      if (plan.status === PLAN_STATUS.DRAFT) {
        return await handlePrimarySave(userId, plan, {
          title,
          content,
          fileID: '',
          type: 'text',
          openid
        });
      }

      if (plan.status === PLAN_STATUS.ACTIVE) {
        return await handleAppendUpload(userId, plan, {
          title,
          content,
          fileID: '',
          type: 'text',
          openid
        });
      }

      if (plan.status === PLAN_STATUS.PENDING_CONFIRM) {
        return {
          error: ERROR.INVALID_STATUS,
          message: '请先确认学习计划，确认后再追加资料'
        };
      }

      return { error: ERROR.INVALID_STATUS, message: '当前计划状态不可上传资料' };
    } catch (e) {
      console.error('[material] text', e);
      if (e && e.code === ERROR.CONTENT_RISKY) {
        return { error: ERROR.CONTENT_RISKY, message: e.message || '内容未通过安全检测' };
      }
      return { error: ERROR.INTERNAL, message: e.message || '生成失败' };
    }
  }

  if (action === 'createFromPdf') {
    if (!planId || !fileID) return { error: ERROR.MISSING_PARAM };
    const plan = await assertPlanOwner(userId, planId);
    if (!plan) return { error: ERROR.NOT_FOUND };

    try {
      const { text, pages, parsedPages } = await extractPdfText(cloud, fileID);

      if (plan.status === PLAN_STATUS.DRAFT) {
        const result = await handlePrimarySave(userId, plan, {
          title,
          content: text,
          fileID,
          type: 'pdf',
          openid
        });
        return { ...result, pages, parsedPages };
      }

      if (plan.status === PLAN_STATUS.ACTIVE) {
        const result = await handleAppendUpload(userId, plan, {
          title,
          content: text,
          fileID,
          type: 'pdf',
          openid
        });
        return { ...result, pages, parsedPages };
      }

      if (plan.status === PLAN_STATUS.PENDING_CONFIRM) {
        return {
          error: ERROR.INVALID_STATUS,
          message: '请先确认学习计划，确认后再追加资料'
        };
      }

      return { error: ERROR.INVALID_STATUS, message: '当前计划状态不可上传资料' };
    } catch (e) {
      console.error('[material] pdf', e);
      if (e && e.code === ERROR.CONTENT_RISKY) {
        return { error: ERROR.CONTENT_RISKY, message: e.message || '内容未通过安全检测' };
      }
      return { error: ERROR.INTERNAL, message: e.message || 'PDF 解析失败' };
    }
  }

  return { error: ERROR.UNKNOWN_ACTION };
};
