const { COLLECTIONS, DEFAULTS } = require('./constants');

function clip(str, max) {
  const s = String(str == null ? '' : str);
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

/**
 * 追加一条 AI 调用审计日志（独立集合，默认保留 180 天字段 expireAt）。
 * 失败只打日志，不阻断主流程。
 */
async function appendAiCallLog(
  db,
  {
    userId,
    openid = '',
    scene = 'chat',
    model = '',
    prompt = '',
    response = '',
    ok = true,
    error = ''
  } = {}
) {
  if (!db || !userId) return null;
  try {
    const now = new Date();
    const days = Number(DEFAULTS.AI_LOG_RETENTION_DAYS) || 180;
    const expireAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    const addRes = await db.collection(COLLECTIONS.AI_CALL_LOGS).add({
      data: {
        userId,
        openid: String(openid || ''),
        scene: String(scene || 'chat'),
        model: String(model || (ok ? '' : 'unknown')),
        prompt: clip(prompt, DEFAULTS.AI_LOG_PROMPT_MAX || 8000),
        response: clip(response, DEFAULTS.AI_LOG_RESPONSE_MAX || 16000),
        ok: !!ok,
        error: clip(error || '', 500),
        createdAt: now,
        expireAt
      }
    });
    return addRes._id;
  } catch (e) {
    console.warn('[aiLog] append failed', e && e.message ? e.message : e);
    return null;
  }
}

/**
 * 删除已过期的 AI 调用日志（expireAt < now）。
 * 分批删除，避免单次超时；供定时云函数调用。
 *
 * @returns {{ deleted: number, batches: number, done: boolean }}
 */
async function purgeExpiredAiLogs(db, options = {}) {
  if (!db) return { deleted: 0, batches: 0, done: true };

  const _ = db.command;
  const now = new Date();
  const batchSize = Math.max(
    1,
    Number(options.batchSize != null ? options.batchSize : DEFAULTS.AI_LOG_CLEANUP_BATCH) || 100
  );
  const maxPerRun = Math.max(
    batchSize,
    Number(options.maxPerRun != null ? options.maxPerRun : DEFAULTS.AI_LOG_CLEANUP_MAX_PER_RUN) ||
      1000
  );

  let deleted = 0;
  let batches = 0;

  while (deleted < maxPerRun) {
    const limit = Math.min(batchSize, maxPerRun - deleted);
    let res;
    try {
      res = await db
        .collection(COLLECTIONS.AI_CALL_LOGS)
        .where({ expireAt: _.lt(now) })
        .limit(limit)
        .get();
    } catch (e) {
      // 无 expireAt 索引或集合不存在时，尝试按 createdAt 兜底（保留天数）
      console.warn('[aiLog] expireAt query failed, fallback createdAt', e && e.message ? e.message : e);
      const days = Number(DEFAULTS.AI_LOG_RETENTION_DAYS) || 180;
      const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      res = await db
        .collection(COLLECTIONS.AI_CALL_LOGS)
        .where({ createdAt: _.lt(cutoff) })
        .limit(limit)
        .get();
    }

    const docs = (res && res.data) || [];
    if (!docs.length) {
      return { deleted, batches, done: true };
    }

    await Promise.all(
      docs.map((d) =>
        db
          .collection(COLLECTIONS.AI_CALL_LOGS)
          .doc(d._id)
          .remove()
          .catch((err) => {
            console.warn('[aiLog] remove failed', d._id, err && err.message ? err.message : err);
          })
      )
    );

    deleted += docs.length;
    batches += 1;

    if (docs.length < limit) {
      return { deleted, batches, done: true };
    }
  }

  return { deleted, batches, done: false };
}

module.exports = { appendAiCallLog, purgeExpiredAiLogs };
