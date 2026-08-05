const { DEFAULTS } = require('./constants');

/**
 * 云函数需把文件读进内存，过大仍会失败；50MB + 智能抽页可覆盖多数讲义。
 * 更大请拆章，或提高云函数内存至 1024MB 后再试。
 */
const MAX_PARSE_BYTES = 50 * 1024 * 1024;
/** 从全文前/中/后各取一部分，总页数预算（不必整本解析） */
const PAGE_BUDGET = 42;
const PDFJS_VERSION = 'v1.10.100';

/**
 * 选取需要解析的页码：小文档全量；大文档前 / 中 / 后均匀覆盖。
 */
function pickPageIndexes(numPages, budget = PAGE_BUDGET) {
  const n = Math.max(0, Number(numPages) || 0);
  if (n <= 0) return [];
  if (n <= budget) {
    return Array.from({ length: n }, (_, i) => i + 1);
  }

  const head = Math.ceil(budget / 3);
  const tail = Math.ceil(budget / 3);
  const mid = Math.max(1, budget - head - tail);
  const set = new Set();

  for (let i = 1; i <= head; i += 1) set.add(i);

  const midStart = Math.max(1, Math.floor((n - mid) / 2) + 1);
  for (let i = 0; i < mid; i += 1) {
    set.add(Math.min(n, midStart + i));
  }

  for (let i = 0; i < tail; i += 1) {
    set.add(n - i);
  }

  return [...set].sort((a, b) => a - b);
}

function pageTextFromContent(textContent) {
  let lastY;
  let text = '';
  const items = (textContent && textContent.items) || [];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const str = item && item.str != null ? String(item.str) : '';
    const y = item && item.transform ? item.transform[5] : null;
    if (lastY == null || y === lastY) {
      text += str;
    } else {
      text += `\n${str}`;
    }
    lastY = y;
  }
  return text;
}

/**
 * 从云存储 PDF 提取纯文本（大文件：只解析前/中/后抽样页，不整本扫）。
 * 依赖 material 云函数目录下的 pdf-parse。
 */
async function extractPdfText(cloud, fileID) {
  // eslint-disable-next-line global-require, import/no-unresolved
  const PDFJS = require(`pdf-parse/lib/pdf.js/${PDFJS_VERSION}/build/pdf.js`);
  PDFJS.disableWorker = true;

  const dl = await cloud.downloadFile({ fileID });
  if (!dl || !dl.fileContent) {
    throw new Error('下载 PDF 失败');
  }

  const buf = dl.fileContent;
  const size = Buffer.isBuffer(buf) ? buf.length : buf.byteLength || 0;
  if (size > MAX_PARSE_BYTES) {
    const mb = Math.round(size / (1024 * 1024));
    throw new Error(
      `PDF 约 ${mb}MB，超过云端单次处理上限（${Math.round(
        MAX_PARSE_BYTES / (1024 * 1024)
      )}MB）。请按章节拆成多个文件上传，或粘贴关键正文`
    );
  }

  let doc;
  try {
    doc = await PDFJS.getDocument(buf);
  } catch (e) {
    console.error('[pdf] getDocument failed', e);
    throw new Error('PDF 打开失败，请确认文件未损坏，或另存为标准 PDF 后再试');
  }

  const numPages = doc.numPages || 0;
  const pages = pickPageIndexes(numPages, PAGE_BUDGET);
  const textBudget = (DEFAULTS.MATERIAL_TEXT_LIMIT || 24000) * 2;
  const parts = [];
  let parsedPages = 0;
  let totalLen = 0;

  try {
    for (let i = 0; i < pages.length; i += 1) {
      const pageNo = pages[i];
      let pageText = '';
      try {
        const page = await doc.getPage(pageNo);
        const content = await page.getTextContent({
          normalizeWhitespace: false,
          disableCombineTextItems: false
        });
        pageText = pageTextFromContent(content);
      } catch (e) {
        console.warn('[pdf] page failed', pageNo, e && e.message);
        pageText = '';
      }

      pageText = String(pageText || '').trim();
      if (pageText) {
        parts.push(`【第${pageNo}页】\n${pageText}`);
        totalLen += pageText.length;
        parsedPages += 1;
      }

      // 已够 AI 抽样用量则提前结束，加快大文件
      if (totalLen >= textBudget) break;
    }
  } finally {
    try {
      if (doc && typeof doc.destroy === 'function') doc.destroy();
    } catch (e) {
      /* ignore */
    }
  }

  let text = parts
    .join('\n\n')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (text.length > textBudget) {
    text = text.slice(0, textBudget);
  }

  if (!text || text.length < 20) {
    throw new Error(
      '未能从 PDF 提取到有效文字（可能是扫描版图片 PDF），请换可复制文本的 PDF，或直接粘贴文字'
    );
  }

  return {
    text,
    pages: numPages,
    parsedPages,
    sampled: numPages > pages.length || parsedPages < numPages,
    sizeBytes: size
  };
}

module.exports = {
  extractPdfText,
  pickPageIndexes,
  MAX_PARSE_BYTES,
  PAGE_BUDGET
};
