const { ERROR, DEFAULTS } = require('./constants');

/** msgSecCheck v2 单次约 2500 字，留余量分片 */
const CHUNK_SIZE = 2400;

const SAFE_REPLY = {
  USER_INPUT: '内容未通过安全检测，请换学习相关的表述后再试。',
  AI_OUTPUT: '抱歉，本次回复未通过内容安全检测，请换个学习相关的问题再试。',
  PLAN: '生成内容未通过安全检测，请调整学习目标后重试。',
  MATERIAL: '资料内容未通过安全检测，请修改后再上传。'
};

function splitChunks(text, size = CHUNK_SIZE) {
  const s = String(text || '');
  if (!s) return [];
  if (s.length <= size) return [s];
  const parts = [];
  for (let i = 0; i < s.length; i += size) {
    parts.push(s.slice(i, i + size));
  }
  return parts;
}

/**
 * 微信文本内容安全（云调用 msgSecCheck v2）。
 * @returns {{ ok: boolean, reason?: string, suggest?: string, skipped?: boolean }}
 */
async function checkTextSafe(cloud, { openid, content, scene = 2 } = {}) {
  const text = String(content || '').trim();
  if (!text) return { ok: true, skipped: true };
  if (!cloud || !cloud.openapi || !cloud.openapi.security) {
    console.warn('[contentSafe] openapi.security 不可用');
    return failOrSkip('no_openapi');
  }
  if (!openid) {
    console.warn('[contentSafe] missing openid');
    return failOrSkip('no_openid');
  }

  const chunks = splitChunks(text);
  for (let i = 0; i < chunks.length; i += 1) {
    try {
      const result = await cloud.openapi.security.msgSecCheck({
        openid,
        version: 2,
        scene,
        content: chunks[i]
      });

      const errCode = result.errCode != null ? result.errCode : result.errcode;
      if (errCode === 87014) {
        return { ok: false, reason: 'risky', suggest: 'risky' };
      }

      const suggest =
        (result.result && result.result.suggest) ||
        (result.detail && result.detail.suggest) ||
        '';

      // pass 放行；review / risky 均拦截（UGC+AI 偏严，降低封环境风险）
      if (suggest === 'risky' || suggest === 'review') {
        return { ok: false, reason: suggest, suggest };
      }
    } catch (e) {
      const code = e && (e.errCode != null ? e.errCode : e.errcode);
      if (code === 87014) {
        return { ok: false, reason: 'risky', suggest: 'risky' };
      }
      console.error('[contentSafe] msgSecCheck error', code, e && e.message ? e.message : e);
      return failOrSkip('api_error', e);
    }
  }

  return { ok: true };
}

function failOrSkip(reason, detail) {
  if (DEFAULTS.CONTENT_SAFE_STRICT) {
    return { ok: false, reason, detail };
  }
  // 未配 openapi / 临时故障：记录后放行，避免整站不可用；上线务必配好权限
  console.warn('[contentSafe] check skipped:', reason);
  return { ok: true, skipped: true, reason, detail };
}

/** 未通过时返回标准业务错误结构 */
function riskyResult(message) {
  return {
    error: ERROR.CONTENT_RISKY,
    message: message || SAFE_REPLY.USER_INPUT
  };
}

/** 计划 JSON → 待检文本 */
function planTextForCheck(planData) {
  if (!planData || typeof planData !== 'object') return '';
  const parts = [];
  if (planData.title) parts.push(planData.title);
  if (planData.goal) parts.push(planData.goal);
  (planData.weeks || []).forEach((w) => {
    if (w && w.theme) parts.push(w.theme);
    (w.topics || []).forEach((t) => parts.push(String(t)));
  });
  (planData.cards || []).forEach((c) => {
    if (!c) return;
    if (c.topic) parts.push(c.topic);
    if (c.question) parts.push(c.question);
    if (c.answer) parts.push(c.answer);
  });
  return parts.join('\n').slice(0, 20000);
}

/** 卡片列表 → 待检文本 */
function cardsTextForCheck(cards) {
  return (cards || [])
    .map((c) => [c && c.topic, c && c.question, c && c.answer].filter(Boolean).join(' '))
    .join('\n')
    .slice(0, 20000);
}

module.exports = {
  checkTextSafe,
  riskyResult,
  planTextForCheck,
  cardsTextForCheck,
  SAFE_REPLY,
  CHUNK_SIZE
};
