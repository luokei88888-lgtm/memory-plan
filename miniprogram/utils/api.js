/**
 * 云函数调用统一封装。
 */
const DEFAULT_TIMEOUT = 20000;
const AI_TIMEOUT = 60000;
/** PDF 解析 / 出计划较慢；与云函数超时对齐，避免前端先断 */
const MATERIAL_TIMEOUT = 120000;

function call(name, data = {}, timeout = DEFAULT_TIMEOUT, options = {}) {
  const allowErrors = options.allowErrors || [];
  console.log(`[cloud] call ${name}`, data && data.action ? { action: data.action } : '');
  return wx.cloud
    .callFunction({
      name,
      data,
      timeout
    })
    .then((res) => {
      const result = res.result || {};
      if (result.error && allowErrors.indexOf(result.error) < 0) {
        return Promise.reject(new Error(result.error));
      }
      return result;
    })
    .catch((err) => {
      console.error(`[cloud] ${name} failed:`, err);
      throw err;
    });
}

async function callWithRetry(name, data, timeout) {
  try {
    return await call(name, data, timeout);
  } catch (e) {
    const msg = (e && (e.errMsg || e.message)) || '';
    if (/timeout|TIMEDOUT|-504003|FUNCTIONS_TIME_LIMIT/i.test(String(msg))) {
      console.warn(`[cloud] ${name} timeout, retry once`);
      return call(name, data, timeout);
    }
    throw e;
  }
}

module.exports = {
  login: () => callWithRetry('login'),
  chat: (payload) =>
    call('chat', payload, AI_TIMEOUT, { allowErrors: ['QUOTA_EXCEEDED', 'CONTENT_RISKY'] }),
  generatePlan: (payload) =>
    call('generatePlan', payload, AI_TIMEOUT, { allowErrors: ['CONTENT_RISKY', 'PLAN_LIMIT'] }),
  confirmPlan: (planId) =>
    call(
      'generatePlan',
      { action: 'confirmPlan', planId },
      AI_TIMEOUT,
      { allowErrors: ['CONTENT_RISKY', 'INVALID_STATUS', 'NOT_FOUND', 'MISSING_PARAM', 'PLAN_LIMIT'] }
    ),
  generateUnitCards: (planId, week = 1) =>
    call(
      'generatePlan',
      { action: 'generateUnitCards', planId, week },
      AI_TIMEOUT,
      { allowErrors: ['CONTENT_RISKY', 'INVALID_STATUS', 'NOT_FOUND', 'MISSING_PARAM'] }
    ),
  getToday: () => callWithRetry('getToday'),
  getPlans: (scope = 'home') => callWithRetry('getToday', { action: 'plans', scope }),
  getPlanDetail: (planId) => callWithRetry('getToday', { action: 'planDetail', planId }),
  managePlan: (planId, op) =>
    call('getToday', { action: 'managePlan', planId, op }, DEFAULT_TIMEOUT, {
      allowErrors: ['INVALID_STATUS', 'NOT_FOUND']
    }),
  startReview: () => callWithRetry('review', { action: 'start' }),
  submitReview: (payload) =>
    call('review', { action: 'submit', ...payload }, DEFAULT_TIMEOUT, {
      allowErrors: ['CONTENT_RISKY']
    }),
  getProfile: () => callWithRetry('userCenter', { action: 'profile' }),
  getReport: () => callWithRetry('userCenter', { action: 'report' }),
  claimAdReward: () => call('userCenter', { action: 'claimAdReward' }),
  claimShareReward: () =>
    call('userCenter', { action: 'claimShareReward' }, DEFAULT_TIMEOUT, {
      allowErrors: ['SHARE_LIMIT']
    }),
  claimInviteReward: (inviterId) =>
    call('userCenter', { action: 'claimInviteReward', inviterId }, DEFAULT_TIMEOUT, {
      allowErrors: ['INVITE_INVALID']
    }),
  setRemind: (enabled) => call('userCenter', { action: 'setRemind', enabled }),
  listMaterials: (planId) => callWithRetry('material', { action: 'list', planId }),
  createMaterialFromText: (payload) =>
    call('material', { action: 'createFromText', ...payload }, MATERIAL_TIMEOUT, {
      allowErrors: ['INTERNAL', 'CONTENT_RISKY', 'INVALID_STATUS', 'PLAN_LIMIT']
    }),
  createMaterialFromPdf: (payload) =>
    call('material', { action: 'createFromPdf', ...payload }, MATERIAL_TIMEOUT, {
      allowErrors: ['INTERNAL', 'CONTENT_RISKY', 'INVALID_STATUS', 'PLAN_LIMIT']
    }),
  buildPlanFromMaterial: (payload) =>
    call('material', { action: 'buildPlan', ...payload }, MATERIAL_TIMEOUT, {
      allowErrors: ['INTERNAL', 'CONTENT_RISKY', 'INVALID_STATUS', 'PLAN_LIMIT', 'MISSING_PARAM']
    })
};
