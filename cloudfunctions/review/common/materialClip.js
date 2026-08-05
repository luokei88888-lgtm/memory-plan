const { DEFAULTS } = require('./constants');

/**
 * 长文不截断成「只看开头」：按头 / 中 / 尾抽样，尽量覆盖整份资料。
 */
function clipMaterialText(text, limit = DEFAULTS.MATERIAL_TEXT_LIMIT) {
  const raw = String(text || '').trim();
  if (raw.length <= limit) return raw;

  const part = Math.floor(limit / 3);
  const head = raw.slice(0, part);
  const midStart = Math.floor((raw.length - part) / 2);
  const mid = raw.slice(midStart, midStart + part);
  const tail = raw.slice(-part);
  return `${head}\n\n……（中间抽样）……\n\n${mid}\n\n……（结尾抽样）……\n\n${tail}`;
}

module.exports = { clipMaterialText };
