const { chatCompletion, extractJson } = require('./ai');
const { addCards } = require('./plan');
const { COLLECTIONS, DEFAULTS, ERROR } = require('./constants');
const { checkTextSafe, cardsTextForCheck, SAFE_REPLY } = require('./contentSafe');
const { appendAiCallLog } = require('./aiLog');
const { clipMaterialText } = require('./materialClip');

const MATERIAL_PROMPT = `你是学习教练。根据用户提供的学习资料，提炼适合主动回忆的记忆卡片。
只输出 JSON（不要 markdown）：
{
  "title": "资料标题（简短）",
  "cards": [
    {"topic":"知识点","question":"用于主动回忆的问题","answer":"简洁参考答案"}
  ]
}
要求：
1. cards 6-12 张，紧扣资料内容，不要编造资料里没有的事实
2. 问题要能闭卷作答；答案简洁准确
3. 若资料过短，仍尽量出 3 张以上卡片
4. 禁止涉政/暴力/违法等违规内容`;

/**
 * 仅落库资料（不出卡），用于草稿计划的主资料上传。
 */
async function saveMaterialOnly(
  db,
  { userId, planId, title, content, fileID, type, isPrimary = false, cloud, openid }
) {
  const text = String(content || '').trim();
  if (!text) {
    throw Object.assign(new Error('资料内容为空'), { code: ERROR.MISSING_PARAM });
  }

  if (cloud && openid) {
    const inCheck = await checkTextSafe(cloud, {
      openid,
      content: `${title || ''}\n${text}`.slice(0, 20000),
      scene: 2
    });
    if (!inCheck.ok) {
      await appendAiCallLog(db, {
        userId,
        openid,
        scene: 'material',
        prompt: text.slice(0, DEFAULTS.AI_LOG_PROMPT_MAX || 8000),
        response: '',
        ok: false,
        error: 'CONTENT_RISKY_INPUT'
      });
      throw Object.assign(new Error(SAFE_REPLY.MATERIAL), { code: ERROR.CONTENT_RISKY });
    }
  }

  const clipped = clipMaterialText(text);
  const materialTitle = title || '学习资料';
  const materialType = type || (fileID ? 'file' : 'text');
  const now = new Date();
  const addRes = await db.collection(COLLECTIONS.MATERIALS).add({
    data: {
      userId,
      planId,
      title: materialTitle,
      type: materialType,
      content: clipped,
      fileID: fileID || '',
      cardCount: 0,
      isPrimary: !!isPrimary,
      createdAt: now
    }
  });

  return {
    materialId: addRes._id,
    title: materialTitle,
    content: clipped,
    cardCount: 0
  };
}

/**
 * 从文本资料生成卡片并落库（进行中计划的追加资料）。
 */
async function createMaterialAndCards(db, { userId, planId, title, content, fileID, type, cloud, openid }) {
  const text = String(content || '').trim();
  if (!text) {
    throw Object.assign(new Error('资料内容为空'), { code: ERROR.MISSING_PARAM });
  }

  if (cloud && openid) {
    const inCheck = await checkTextSafe(cloud, {
      openid,
      content: `${title || ''}\n${text}`.slice(0, 20000),
      scene: 2
    });
    if (!inCheck.ok) {
      await appendAiCallLog(db, {
        userId,
        openid,
        scene: 'material',
        prompt: text.slice(0, DEFAULTS.AI_LOG_PROMPT_MAX || 8000),
        response: '',
        ok: false,
        error: 'CONTENT_RISKY_INPUT'
      });
      throw Object.assign(new Error(SAFE_REPLY.MATERIAL), { code: ERROR.CONTENT_RISKY });
    }
  }

  // 限长控 token：长资料头/中/尾抽样，避免大 PDF 只学到前几页
  const clipped = clipMaterialText(text);
  let cards = [];
  let materialTitle = title || '学习资料';
  const materialType = type || (fileID ? 'file' : 'text');
  let aiModel = 'mock';
  let rawResponse = '';
  let aiOk = true;
  let aiError = '';

  try {
    const ai = await chatCompletion({
      messages: [
        { role: 'system', content: MATERIAL_PROMPT },
        {
          role: 'user',
          content: `请基于以下资料生成记忆卡片：\n\n【标题】${materialTitle}\n\n【正文】\n${clipped}`
        }
      ],
      temperature: 0.3,
      responseFormat: { type: 'json_object' }
    });

    aiModel = ai.model || (ai.mock ? 'mock' : '');
    rawResponse = ai.mock ? '' : ai.content || '';

    if (!ai.mock) {
      const parsed = extractJson(ai.content) || {};
      if (parsed.title) materialTitle = parsed.title;
      cards = (parsed.cards || [])
        .filter((c) => c && c.question && c.answer)
        .map((c) => ({ ...c, source: 'material' }));
    }
  } catch (e) {
    if (e && e.code === ERROR.CONTENT_RISKY) throw e;
    console.error('[material] AI error', e);
    aiOk = false;
    aiError = (e && e.message) || 'AI_ERROR';
  }

  if (!cards.length) {
    // 无 Key / 解析失败时的兜底：从段落抽简单问答
    cards = buildFallbackCards(clipped);
    if (!rawResponse) {
      rawResponse = JSON.stringify({ title: materialTitle, cards });
      aiModel = aiModel || 'mock';
    }
  }

  await appendAiCallLog(db, {
    userId,
    openid: openid || '',
    scene: 'material',
    model: aiModel,
    prompt: clipped.slice(0, DEFAULTS.AI_LOG_PROMPT_MAX || 8000),
    response: rawResponse,
    ok: aiOk,
    error: aiError
  });

  if (cloud && openid) {
    const outCheck = await checkTextSafe(cloud, {
      openid,
      content: `${materialTitle}\n${cardsTextForCheck(cards)}`,
      scene: 2
    });
    if (!outCheck.ok) {
      throw Object.assign(new Error(SAFE_REPLY.PLAN), { code: ERROR.CONTENT_RISKY });
    }
  }

  const now = new Date();
  const addRes = await db.collection(COLLECTIONS.MATERIALS).add({
    data: {
      userId,
      planId,
      title: materialTitle,
      type: materialType,
      content: clipped,
      fileID: fileID || '',
      cardCount: cards.length,
      isPrimary: false,
      createdAt: now
    }
  });

  const cardCount = await addCards(db, userId, planId, cards);
  return {
    materialId: addRes._id,
    title: materialTitle,
    cardCount
  };
}

function buildFallbackCards(text) {
  const chunks = text
    .split(/\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12)
    .slice(0, 6);

  if (!chunks.length) {
    return [
      {
        topic: '资料要点',
        question: '这份资料最核心的 3 个要点是什么？',
        answer: text.slice(0, 200),
        source: 'material'
      }
    ];
  }

  return chunks.map((c, i) => ({
    topic: `要点 ${i + 1}`,
    question: `请复述这段内容的关键信息：\n${c.slice(0, 80)}${c.length > 80 ? '…' : ''}`,
    answer: c.slice(0, 300),
    source: 'material'
  }));
}

module.exports = { createMaterialAndCards, saveMaterialOnly, clipMaterialText };
