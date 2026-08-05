const cloud = require('wx-server-sdk');
const {
  ensureUser,
  chatCompletion,
  createDraftPlan,
  appendMessages,
  consumeQuota,
  checkTextSafe,
  appendAiCallLog,
  SAFE_REPLY,
  COLLECTIONS,
  DEFAULTS,
  ERROR
} = require('./common');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

/**
 * 多轮澄清后创建草稿计划，引导上传资料；正式周安排与卡片基于资料生成。
 */
const SYSTEM_PROMPT = `你是「忆习」学习规划助手。通过多轮对话了解用户情况，再创建学习草稿并引导上传资料。

角色边界：
- 只讨论学习目标、路径、节奏、复习方法；跑题时礼貌拉回学习话题。
- 不要编造用户未提供的考试日期、年限、公司或成绩。
- 禁止输出涉政、暴力、色情、违法等违规内容。

对话节奏（必须遵守）：
1. 用户刚提出目标时：先共情，再追问 1-2 个关键问题（每天可投入时间、周期/截止、基础水平、场景侧重等），本轮不要输出 [[CREATE_DRAFT]]。
2. 信息仍不足：继续简短追问或给出轻量建议，仍不要输出 [[CREATE_DRAFT]]。
3. 信息大致够了：用几句话总结你理解的目标，并明确说明：「下一步需要你上传学习资料（笔记/讲义/词表/面经等），计划和复习卡片都会基于你的资料生成。现在可以为你创建学习草稿并开始上传吗？」本轮仍不要输出 [[CREATE_DRAFT]]。
4. 仅当用户在本轮明确表示同意（如：需要/可以/好的/开始吧/上传）时，才在回复末尾单独追加一行：[[CREATE_DRAFT]]
5. 用户拒绝或说先聊聊：尊重其选择，继续对话，不要输出 [[CREATE_DRAFT]]。

重要：你不要在对话里直接生成完整周计划或记忆卡片；正式计划在用户上传资料后由系统生成，并需用户确认。

回复要求：简洁中文，每次只问 1-2 个问题，避免一次抛出长篇完整周计划。`;

const DRAFT_MARKER = /\[\[CREATE_DRAFT\]\]/;
/** 兼容旧标记，避免模型仍输出旧指令 */
const LEGACY_PLAN_MARKER = /\[\[GENERATE_PLAN\]\]/;

/** 用户本轮是否像在确认「可以继续」 */
const CONFIRM_RE =
  /^(好的?|可以|行|要|需要|生成|开始|定了|就这样|没问题|同意|是的?|嗯+|ok|okay|yes|上传)\b|生成(计划|吧)|可以生成|需要生成|帮我生成|开始生成|出计划|正式计划|上传资料|开始上传/i;

function stripMarker(text) {
  return (text || '')
    .replace(/\[\[CREATE_DRAFT\]\]/g, '')
    .replace(/\[\[GENERATE_PLAN\]\]/g, '')
    .trim();
}

/** 把多轮用户表述拼成目标，避免确认语「好的」丢失上下文 */
function buildPlanGoal(history, latest) {
  const parts = [];
  (history || []).forEach((m) => {
    if (m && m.role === 'user' && m.content) parts.push(String(m.content).trim());
  });
  if (latest) parts.push(String(latest).trim());
  return parts.filter(Boolean).join('\n').slice(0, 2500) || String(latest || '');
}

function countUserTurns(history) {
  return (history || []).filter((m) => m && m.role === 'user').length;
}

function draftTitleFromGoal(goal) {
  const line = String(goal || '')
    .split('\n')
    .map((s) => s.trim())
    .find(Boolean);
  if (!line) return '待完善的学习计划';
  return line.length > 24 ? `${line.slice(0, 24)}…` : line;
}

async function createDraftForUser(userId, goal, conversationId, openid) {
  if (openid) {
    const outCheck = await checkTextSafe(cloud, {
      openid,
      content: goal,
      scene: 2
    });
    if (!outCheck.ok) {
      return { error: ERROR.CONTENT_RISKY };
    }
  }
  const { planId } = await createDraftPlan(db, userId, {
    goal,
    title: draftTitleFromGoal(goal),
    conversationId: conversationId || ''
  });
  return { planId };
}

exports.main = async (event) => {
  const { message, history = [], conversationId } = event;
  if (!message) return { error: ERROR.MISSING_PARAM };

  const { userId, user, openid } = await ensureUser(cloud, db);

  const inputCheck = await checkTextSafe(cloud, { openid, content: message, scene: 2 });
  if (!inputCheck.ok) {
    await appendAiCallLog(db, {
      userId,
      openid,
      scene: 'chat',
      model: '',
      prompt: message,
      response: '',
      ok: false,
      error: 'CONTENT_RISKY_INPUT'
    });
    return {
      error: ERROR.CONTENT_RISKY,
      reply: SAFE_REPLY.USER_INPUT,
      conversationId: conversationId || '',
      dailyQuota: user.dailyQuota
    };
  }

  let quota = { ok: true, dailyQuota: user.dailyQuota };
  if (DEFAULTS.ENFORCE_QUOTA) {
    quota = await consumeQuota(db, userId, user);
    if (!quota.ok) {
      return {
        error: ERROR.QUOTA_EXCEEDED,
        reply: '今日 AI 对话次数已用完。可在「我的」页看广告领取额外次数，或明天再来。',
        conversationId: conversationId || '',
        dailyQuota: 0,
        canWatchAd: quota.canWatchAd
      };
    }
  }

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.slice(-12).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: message }
  ];

  let reply = '';
  let planId = '';
  let needUpload = false;
  let aiModel = '';
  let rawAiContent = '';
  let aiOk = true;
  let aiError = '';

  try {
    const ai = await chatCompletion({ messages, temperature: 0.6 });
    aiModel = ai.model || (ai.mock ? 'mock' : '');
    rawAiContent = ai.mock ? '' : ai.content || '';

    if (ai.mock) {
      const turns = countUserTurns(history) + 1;
      if (turns <= 1) {
        reply =
          '收到！先确认几件事，后面计划和卡片会更贴合你：\n1）每天大概能投入多久？\n2）准备用多久完成（例如 2 周 / 1 个月）？\n3）基础怎么样？\n\n你补充后，我再请你上传学习资料～';
        rawAiContent = reply;
      } else if (!CONFIRM_RE.test(String(message).trim())) {
        reply =
          '了解了。下一步需要你上传学习资料（笔记、讲义、词表或面经等），计划和复习卡片都会基于你的资料生成。\n现在可以为你创建学习草稿并开始上传吗？';
        rawAiContent = reply;
      } else {
        reply =
          '好的，已为你创建学习草稿。请上传你的学习资料，我将据此生成周计划，确认后再为你出复习卡片。';
        rawAiContent = reply;
        const draftRes = await createDraftForUser(
          userId,
          buildPlanGoal(history, message),
          conversationId,
          openid
        );
        if (draftRes.error === ERROR.CONTENT_RISKY) {
          reply = SAFE_REPLY.PLAN;
        } else {
          planId = draftRes.planId || '';
          needUpload = !!planId;
        }
      }
    } else {
      reply = stripMarker(ai.content);
      const needDraft =
        DRAFT_MARKER.test(ai.content || '') || LEGACY_PLAN_MARKER.test(ai.content || '');
      if (needDraft) {
        const draftRes = await createDraftForUser(
          userId,
          buildPlanGoal(history, message),
          conversationId,
          openid
        );
        if (draftRes.planId) {
          planId = draftRes.planId;
          needUpload = true;
          if (!/上传|资料/.test(reply)) {
            reply +=
              '\n\n已创建学习草稿。请点击下方上传学习资料，我将据此生成计划供你确认，确认后再出复习卡片。';
          }
        } else if (draftRes.error === ERROR.CONTENT_RISKY) {
          reply = SAFE_REPLY.PLAN;
        } else {
          console.error('[chat] createDraft error:', draftRes);
          reply += '\n\n草稿创建暂时失败，可稍后再试。';
        }
      }
    }
  } catch (e) {
    console.error('[chat] AI error:', e && e.message ? e.message : e);
    aiOk = false;
    aiError = (e && e.message) || 'AI_ERROR';
    reply =
      'AI 服务暂时异常。你可以稍后再试；或先告诉我每天能学多久、想侧重哪一块，恢复后我再帮你继续。';
  }

  const outCheck = await checkTextSafe(cloud, { openid, content: reply, scene: 2 });
  if (!outCheck.ok) {
    reply = SAFE_REPLY.AI_OUTPUT;
    planId = '';
    needUpload = false;
    aiOk = false;
    aiError = aiError || 'CONTENT_RISKY_OUTPUT';
  }

  await appendAiCallLog(db, {
    userId,
    openid,
    scene: 'chat',
    model: aiModel,
    prompt: message,
    response: rawAiContent || reply,
    ok: aiOk,
    error: aiError
  });

  const newConversationId = await appendMessages(db, {
    userId,
    conversationId,
    userMessage: message,
    aiReply: reply
  });

  // 草稿创建时若尚无 conversationId，回写关联
  if (planId && newConversationId) {
    try {
      await db.collection(COLLECTIONS.STUDY_PLANS).doc(planId).update({
        data: { conversationId: newConversationId, updatedAt: new Date() }
      });
    } catch (e) {
      console.warn('[chat] bind conversationId failed', e);
    }
  }

  return {
    reply,
    planId,
    needUpload,
    conversationId: newConversationId,
    dailyQuota: quota.dailyQuota,
    ...(outCheck && !outCheck.ok ? { error: ERROR.CONTENT_RISKY } : {})
  };
};
