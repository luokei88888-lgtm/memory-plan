const { chatCompletion, extractJson } = require('./ai');
const { buildMockPlan, buildMockPlanFromMaterial } = require('./mock');
const {
  persistPlan,
  applyMaterialPlan,
  addCards,
  getOwnedPlan,
  managePlan
} = require('./plan');
const { consumePlanGen } = require('./quota');
const { COLLECTIONS, DEFAULTS, ERROR, PLAN_STATUS } = require('./constants');
const { checkTextSafe, planTextForCheck, cardsTextForCheck, SAFE_REPLY } = require('./contentSafe');
const { appendAiCallLog } = require('./aiLog');
const { inferWeekCount, clampWeekCount } = require('./planDuration');
const { clipMaterialText } = require('./materialClip');

const PLAN_PROMPT = `你是学习规划专家。根据用户目标输出 JSON（不要 markdown）：
{
  "title": "计划标题",
  "goal": "一句话目标",
  "scene": "job|exam|skill|interest|language|reading",
  "weeks": [{"week":1,"theme":"主题","topics":["知识点1","知识点2"]}],
  "cards": [{"topic":"知识点","question":"用于主动回忆的问题","answer":"简洁参考答案"}]
}
硬性要求：
1. weeks 的数量必须严格等于系统给出的「目标周数」，week 字段从 1 连续编号到该周数；禁止固定成 4 周。
2. 若用户说了 2 周 / 8 周 / 30 天 / 2 个月等周期，周数必须与之匹配（天按约 7 天=1 周折算，月按约 4 周折算）。
3. cards 6-12 张；内容贴合用户目标；由浅入深安排各周主题。
4. 只输出 JSON；禁止涉政/暴力/违法等违规内容。`;

const MATERIAL_PLAN_PROMPT = `你是学习规划专家。根据用户目标与学习资料，制定「吃透这份资料」的周学习计划。
只输出 JSON（不要 markdown）：
{
  "title": "计划标题",
  "goal": "一句话目标",
  "scene": "job|exam|skill|interest|language|reading",
  "weeks": [{"week":1,"theme":"本周主题（对应资料某块）","topics":["具体知识点1","知识点2","知识点3"]}]
}
硬性要求：
1. weeks 数量必须严格等于系统给出的「目标周数」，week 从 1 连续编号；禁止固定成 4 周。
2. 各周 theme/topics 必须紧扣资料内容与结构（章节、小标题、要点），不要编造资料没有的知识点。
3. topics 要具体可执行，禁止空泛的「打基础/深化理解」。
4. 本阶段只出计划，不要输出 cards 字段。
5. 禁止涉政/暴力/违法等违规内容。`;

const UNIT_CARDS_PROMPT = `你是学习教练。根据学习资料与本周学习主题，提炼适合主动回忆的记忆卡片。
只输出 JSON（不要 markdown）：
{
  "cards": [
    {"topic":"知识点","question":"闭卷可答的问题（面试/测验口吻）","answer":"简洁参考答案或采分点列表"}
  ]
}
要求：
1. cards 6-12 张，紧扣「本周主题/topics」与资料，不要编造资料没有的事实
2. 一卡一点；问题能闭卷作答；答案简洁可对照
3. 简答场景用要点列举；语言/单词可用释义
4. 禁止涉政/暴力/违法等违规内容`;

/**
 * 旧路径：目标直接生成计划+卡片（generatePlan 云函数仍可用，主流程勿走）。
 */
async function generateAndPersistPlan(db, userId, { goal, history = [], cloud, openid } = {}) {
  if (!userId) return { error: ERROR.MISSING_PARAM };
  if (!goal || !String(goal).trim()) return { error: ERROR.MISSING_PARAM };

  const minW = DEFAULTS.MIN_PLAN_WEEKS || 1;
  const maxW = DEFAULTS.MAX_PLAN_WEEKS || 24;
  const targetWeeks = clampWeekCount(inferWeekCount(goal, 4), minW, maxW);

  if (cloud && openid) {
    const inCheck = await checkTextSafe(cloud, { openid, content: goal, scene: 2 });
    if (!inCheck.ok) {
      await appendAiCallLog(db, {
        userId,
        openid,
        scene: 'plan',
        prompt: goal,
        response: '',
        ok: false,
        error: 'CONTENT_RISKY_INPUT'
      });
      return { error: ERROR.CONTENT_RISKY, message: SAFE_REPLY.USER_INPUT };
    }
  }

  if (DEFAULTS.ENFORCE_QUOTA) {
    const gate = await consumePlanGen(db, userId);
    if (!gate.ok) {
      return { error: ERROR.PLAN_LIMIT, message: '今日生成计划次数已达上限，明天再来。' };
    }
  }

  let planData = null;
  let aiModel = 'mock';
  let rawResponse = '';
  let aiOk = true;
  let aiError = '';

  try {
    const ai = await chatCompletion({
      messages: [
        { role: 'system', content: PLAN_PROMPT },
        ...history.slice(-6).map((m) => ({ role: m.role, content: m.content })),
        {
          role: 'user',
          content: `请为以下目标生成学习计划。\n目标周数（必须严格遵守）：${targetWeeks}\n用户目标：${goal}`
        }
      ],
      temperature: 0.4,
      responseFormat: { type: 'json_object' }
    });

    aiModel = ai.model || (ai.mock ? 'mock' : '');
    rawResponse = ai.mock ? '' : ai.content || '';
    planData = ai.mock ? buildMockPlan(goal) : extractJson(ai.content) || buildMockPlan(goal);
    if (ai.mock) {
      rawResponse = JSON.stringify(planData);
    }
  } catch (e) {
    console.error('[generateAndPersistPlan] AI error:', e && e.message ? e.message : e);
    aiOk = false;
    aiError = (e && e.message) || 'AI_ERROR';
    planData = buildMockPlan(goal);
    rawResponse = JSON.stringify(planData);
    aiModel = aiModel || 'mock';
  }

  planData = normalizePlanWeeks(planData, targetWeeks, goal);

  await appendAiCallLog(db, {
    userId,
    openid: openid || '',
    scene: 'plan',
    model: aiModel,
    prompt: goal,
    response: rawResponse,
    ok: aiOk,
    error: aiError
  });

  if (cloud && openid) {
    const outCheck = await checkTextSafe(cloud, {
      openid,
      content: planTextForCheck(planData),
      scene: 2
    });
    if (!outCheck.ok) {
      return { error: ERROR.CONTENT_RISKY, message: SAFE_REPLY.PLAN };
    }
  }

  const result = await persistPlan(db, userId, planData);
  return { ...result, plan: planData, targetWeeks };
}

/**
 * 基于主资料为草稿计划生成周安排（不出卡），状态 → pending_confirm。
 */
async function generatePlanFromMaterial(
  db,
  userId,
  { planId, materialText, materialTitle, materialId, cloud, openid } = {}
) {
  if (!userId || !planId) return { error: ERROR.MISSING_PARAM };
  const plan = await getOwnedPlan(db, userId, planId);
  if (!plan) return { error: ERROR.NOT_FOUND };
  if (plan.status !== PLAN_STATUS.DRAFT) {
    return { error: ERROR.INVALID_STATUS, message: '仅草稿计划可基于资料生成安排' };
  }

  const goal = plan.goal || materialTitle || '吃透学习资料';
  const text = String(materialText || '').trim();
  if (!text) return { error: ERROR.MISSING_PARAM, message: '资料内容为空' };

  const minW = DEFAULTS.MIN_PLAN_WEEKS || 1;
  const maxW = DEFAULTS.MAX_PLAN_WEEKS || 24;
  const targetWeeks = clampWeekCount(inferWeekCount(goal, 4), minW, maxW);
  const clipped = clipMaterialText(text);

  if (cloud && openid) {
    const inCheck = await checkTextSafe(cloud, {
      openid,
      content: `${goal}\n${clipped}`.slice(0, 20000),
      scene: 2
    });
    if (!inCheck.ok) {
      await appendAiCallLog(db, {
        userId,
        openid,
        scene: 'plan',
        prompt: clipped.slice(0, DEFAULTS.AI_LOG_PROMPT_MAX || 8000),
        response: '',
        ok: false,
        error: 'CONTENT_RISKY_INPUT'
      });
      return { error: ERROR.CONTENT_RISKY, message: SAFE_REPLY.USER_INPUT };
    }
  }

  if (DEFAULTS.ENFORCE_QUOTA) {
    const gate = await consumePlanGen(db, userId);
    if (!gate.ok) {
      return { error: ERROR.PLAN_LIMIT, message: '今日生成计划次数已达上限，明天再来。' };
    }
  }

  let planData = null;
  let aiModel = 'mock';
  let rawResponse = '';
  let aiOk = true;
  let aiError = '';

  try {
    const ai = await chatCompletion({
      messages: [
        { role: 'system', content: MATERIAL_PLAN_PROMPT },
        {
          role: 'user',
          content: `请基于资料制定学习计划。\n目标周数（必须严格遵守）：${targetWeeks}\n用户目标：${goal}\n资料标题：${materialTitle || plan.title || '学习资料'}\n\n【资料正文】\n${clipped}`
        }
      ],
      temperature: 0.35,
      responseFormat: { type: 'json_object' }
    });

    aiModel = ai.model || (ai.mock ? 'mock' : '');
    rawResponse = ai.mock ? '' : ai.content || '';
    planData = ai.mock
      ? buildMockPlanFromMaterial(goal, clipped)
      : extractJson(ai.content) || buildMockPlanFromMaterial(goal, clipped);
    if (ai.mock) rawResponse = JSON.stringify(planData);
  } catch (e) {
    console.error('[generatePlanFromMaterial] AI error:', e && e.message ? e.message : e);
    aiOk = false;
    aiError = (e && e.message) || 'AI_ERROR';
    planData = buildMockPlanFromMaterial(goal, clipped);
    rawResponse = JSON.stringify(planData);
    aiModel = aiModel || 'mock';
  }

  planData = normalizePlanWeeks(planData, targetWeeks, goal);
  delete planData.cards;

  await appendAiCallLog(db, {
    userId,
    openid: openid || '',
    scene: 'plan',
    model: aiModel,
    prompt: clipped.slice(0, DEFAULTS.AI_LOG_PROMPT_MAX || 8000),
    response: rawResponse,
    ok: aiOk,
    error: aiError
  });

  if (cloud && openid) {
    const outCheck = await checkTextSafe(cloud, {
      openid,
      content: planTextForCheck(planData),
      scene: 2
    });
    if (!outCheck.ok) {
      return { error: ERROR.CONTENT_RISKY, message: SAFE_REPLY.PLAN };
    }
  }

  await applyMaterialPlan(db, planId, planData, { primaryMaterialId: materialId || '' });
  return {
    planId,
    status: PLAN_STATUS.PENDING_CONFIRM,
    plan: planData,
    targetWeeks
  };
}

/**
 * 确认计划后（或 active 计划）按周从主资料生成卡片。
 */
async function generateUnitCards(db, userId, { planId, week = 1, cloud, openid } = {}) {
  if (!userId || !planId) return { error: ERROR.MISSING_PARAM };
  const plan = await getOwnedPlan(db, userId, planId);
  if (!plan) return { error: ERROR.NOT_FOUND };
  if (plan.status !== PLAN_STATUS.ACTIVE) {
    return { error: ERROR.INVALID_STATUS, message: '请先确认计划后再生成卡片' };
  }

  const weekNum = Math.max(1, Number(week) || 1);
  const weekMeta = (plan.weeks || []).find((w) => Number(w.week) === weekNum) || (plan.weeks || [])[weekNum - 1];
  if (!weekMeta) {
    return { error: ERROR.MISSING_PARAM, message: '计划中没有对应周次' };
  }

  const done = Array.isArray(plan.cardsGeneratedUnits) ? plan.cardsGeneratedUnits : [];
  if (done.indexOf(weekNum) >= 0) {
    return { error: ERROR.INVALID_STATUS, message: `第 ${weekNum} 周卡片已生成` };
  }

  let materialText = '';
  let materialTitle = plan.title || '学习资料';
  if (plan.primaryMaterialId) {
    try {
      const matRes = await db.collection(COLLECTIONS.MATERIALS).doc(plan.primaryMaterialId).get();
      const mat = matRes.data;
      if (mat && mat.userId === userId) {
        materialText = mat.content || '';
        materialTitle = mat.title || materialTitle;
      }
    } catch (e) {
      console.warn('[generateUnitCards] load primary material failed', e);
    }
  }
  if (!materialText) {
    const list = await db
      .collection(COLLECTIONS.MATERIALS)
      .where({ userId, planId })
      .limit(1)
      .get();
    const first = (list.data || [])[0];
    if (first) {
      materialText = first.content || '';
      materialTitle = first.title || materialTitle;
    }
  }
  if (!materialText) {
    return { error: ERROR.MISSING_PARAM, message: '缺少学习资料，无法出卡' };
  }

  const clipped = clipMaterialText(materialText);
  const topics = Array.isArray(weekMeta.topics) ? weekMeta.topics.join('、') : '';
  const unitLabel = `第${weekNum}周：${weekMeta.theme || ''}（${topics}）`;

  let cards = [];
  let aiModel = 'mock';
  let rawResponse = '';
  let aiOk = true;
  let aiError = '';

  try {
    const ai = await chatCompletion({
      messages: [
        { role: 'system', content: UNIT_CARDS_PROMPT },
        {
          role: 'user',
          content: `用户目标：${plan.goal || ''}\n本周安排：${unitLabel}\n资料标题：${materialTitle}\n\n【资料正文】\n${clipped}`
        }
      ],
      temperature: 0.3,
      responseFormat: { type: 'json_object' }
    });

    aiModel = ai.model || (ai.mock ? 'mock' : '');
    rawResponse = ai.mock ? '' : ai.content || '';
    if (!ai.mock) {
      const parsed = extractJson(ai.content) || {};
      cards = (parsed.cards || [])
        .filter((c) => c && c.question && c.answer)
        .map((c) => ({ ...c, source: 'material', week: weekNum }));
    }
  } catch (e) {
    console.error('[generateUnitCards] AI error', e);
    aiOk = false;
    aiError = (e && e.message) || 'AI_ERROR';
  }

  if (!cards.length) {
    cards = buildUnitFallbackCards(clipped, weekNum, weekMeta);
    if (!rawResponse) {
      rawResponse = JSON.stringify({ cards });
      aiModel = aiModel || 'mock';
    }
  }

  await appendAiCallLog(db, {
    userId,
    openid: openid || '',
    scene: 'material',
    model: aiModel,
    prompt: `${unitLabel}\n${clipped}`.slice(0, DEFAULTS.AI_LOG_PROMPT_MAX || 8000),
    response: rawResponse,
    ok: aiOk,
    error: aiError
  });

  if (cloud && openid) {
    const outCheck = await checkTextSafe(cloud, {
      openid,
      content: cardsTextForCheck(cards),
      scene: 2
    });
    if (!outCheck.ok) {
      return { error: ERROR.CONTENT_RISKY, message: SAFE_REPLY.PLAN };
    }
  }

  const cardCount = await addCards(db, userId, planId, cards);
  const nextUnits = done.concat([weekNum]);
  await db.collection(COLLECTIONS.STUDY_PLANS).doc(planId).update({
    data: {
      cardsGeneratedUnits: nextUnits,
      updatedAt: new Date()
    }
  });

  return { ok: true, week: weekNum, cardCount, cardsGeneratedUnits: nextUnits };
}

/**
 * 确认计划并生成第 1 周卡片。
 */
async function confirmPlanAndGenerateFirstUnit(db, userId, { planId, cloud, openid } = {}) {
  const confirmed = await managePlan(db, userId, planId, 'confirm', { cloud });
  if (confirmed.error) return confirmed;
  const cardsRes = await generateUnitCards(db, userId, { planId, week: 1, cloud, openid });
  if (cardsRes.error) {
    return {
      ok: true,
      status: PLAN_STATUS.ACTIVE,
      confirmed: true,
      cardsError: cardsRes.error,
      message: cardsRes.message || '计划已确认，但首周卡片生成失败，可稍后重试'
    };
  }
  return {
    ok: true,
    status: PLAN_STATUS.ACTIVE,
    confirmed: true,
    week: 1,
    cardCount: cardsRes.cardCount || 0
  };
}

function buildUnitFallbackCards(text, weekNum, weekMeta) {
  const theme = (weekMeta && weekMeta.theme) || `第${weekNum}周`;
  const topics = (weekMeta && weekMeta.topics) || [];
  const fromTopics = topics.slice(0, 6).map((t, i) => ({
    topic: t || `要点 ${i + 1}`,
    question: `关于「${t}」，请用自己的话说明关键点（结合你的资料）。`,
    answer: `对照资料中与「${t}」相关的段落作答；答出定义/要点/注意点即可。`,
    source: 'material',
    week: weekNum
  }));
  if (fromTopics.length) return fromTopics;

  const chunks = String(text || '')
    .split(/\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12)
    .slice(0, 6);
  if (!chunks.length) {
    return [
      {
        topic: theme,
        question: `本周主题「${theme}」最核心的 3 个要点是什么？`,
        answer: text.slice(0, 200),
        source: 'material',
        week: weekNum
      }
    ];
  }
  return chunks.map((c, i) => ({
    topic: `${theme} · ${i + 1}`,
    question: `请复述这段内容的关键信息：\n${c.slice(0, 80)}${c.length > 80 ? '…' : ''}`,
    answer: c.slice(0, 300),
    source: 'material',
    week: weekNum
  }));
}

/** 校正 weeks 数量与编号，避免模型仍输出固定 4 周 */
function normalizePlanWeeks(planData, targetWeeks, goal) {
  const plan = planData && typeof planData === 'object' ? { ...planData } : buildMockPlan(goal);
  let weeks = Array.isArray(plan.weeks) ? plan.weeks.slice() : [];

  if (weeks.length > targetWeeks) {
    weeks = weeks.slice(0, targetWeeks);
  }
  while (weeks.length < targetWeeks) {
    const n = weeks.length + 1;
    weeks.push({
      week: n,
      theme: `第${n}周学习`,
      topics: ['本周核心知识点', '练习与应用', '复习巩固']
    });
  }

  plan.weeks = weeks.map((w, i) => ({
    week: i + 1,
    theme: (w && w.theme) || `第${i + 1}周学习`,
    topics:
      w && Array.isArray(w.topics) && w.topics.length
        ? w.topics
        : ['本周核心知识点', '练习与应用', '复习巩固']
  }));

  if (!plan.goal) plan.goal = goal;
  return plan;
}

module.exports = {
  generateAndPersistPlan,
  generatePlanFromMaterial,
  generateUnitCards,
  confirmPlanAndGenerateFirstUnit,
  PLAN_PROMPT,
  MATERIAL_PLAN_PROMPT,
  normalizePlanWeeks
};
