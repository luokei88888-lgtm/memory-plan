/**
 * 定时清理过期 AI 调用日志（ai_call_logs.expireAt < now）。
 *
 * 部署后请确认触发器已生效（config.json 已声明；也可在云开发控制台核对）：
 *   每天 03:00（东八区按控制台时区理解，cron 为 UTC+8 常见写法）
 *   0 0 3 * * * *
 *
 * 控制台建议：为 ai_call_logs 建索引 expireAt（升序）。
 */
const cloud = require('wx-server-sdk');
const { purgeExpiredAiLogs } = require('./common');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async () => {
  const started = Date.now();
  try {
    const result = await purgeExpiredAiLogs(db);
    console.log('[cleanupAiLogs]', result, `elapsed=${Date.now() - started}ms`);
    return {
      ok: true,
      ...result,
      elapsedMs: Date.now() - started
    };
  } catch (e) {
    console.error('[cleanupAiLogs] failed', e && e.message ? e.message : e);
    return {
      ok: false,
      error: (e && e.message) || 'CLEANUP_FAILED',
      elapsedMs: Date.now() - started
    };
  }
};
