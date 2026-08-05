const cloud = require('wx-server-sdk');
const {
  ensureUser,
  generateAndPersistPlan,
  confirmPlanAndGenerateFirstUnit,
  generateUnitCards,
  ERROR
} = require('./common');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const { action = 'generate', goal, history = [], planId, week } = event;
  const { userId, openid } = await ensureUser(cloud, db);

  if (action === 'confirmPlan') {
    if (!planId) return { error: ERROR.MISSING_PARAM };
    return confirmPlanAndGenerateFirstUnit(db, userId, { planId, cloud, openid });
  }

  if (action === 'generateUnitCards') {
    if (!planId) return { error: ERROR.MISSING_PARAM };
    return generateUnitCards(db, userId, {
      planId,
      week: week || 1,
      cloud,
      openid
    });
  }

  // 旧路径：仅目标直接出计划+卡（主流程已不用）
  if (!goal || !String(goal).trim()) {
    return { error: ERROR.MISSING_PARAM };
  }
  return generateAndPersistPlan(db, userId, { goal, history, cloud, openid });
};
