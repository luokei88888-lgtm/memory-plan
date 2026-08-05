/**
 * 统一大模型调用。通过环境变量切换供应商：
 *   AI_API_KEY / AI_BASE_URL / AI_MODEL
 * 默认 DeepSeek（兼容 OpenAI 协议）。未配置 Key 时返回 mock 标记，交由业务兜底。
 *
 * 使用 Node 内置 https，避免云函数低版本 Node 无全局 fetch 导致调用失败。
 */
const https = require('https');
const http = require('http');
const { URL } = require('url');

function requestJson(urlString, { method = 'POST', headers = {}, body = '' } = {}) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(urlString);
    } catch (e) {
      reject(new Error(`AI_BASE_URL 无效: ${urlString}`));
      return;
    }

    const lib = url.protocol === 'http:' ? http : https;
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'http:' ? 80 : 443),
        path: `${url.pathname}${url.search}`,
        method,
        headers: {
          ...headers,
          'Content-Length': Buffer.byteLength(body)
        },
        timeout: 55000
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode || 0, text });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('AI 请求超时'));
    });
    req.on('error', (err) => reject(err));
    req.write(body);
    req.end();
  });
}

async function chatCompletion({ messages, temperature = 0.7, responseFormat } = {}) {
  const model = process.env.AI_MODEL || 'deepseek-chat';
  const apiKey = process.env.AI_API_KEY || '';
  if (!apiKey) {
    return { mock: true, content: null, model: 'mock' };
  }

  const baseUrl = (process.env.AI_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/$/, '');

  const payload = { model, messages, temperature };
  if (responseFormat) payload.response_format = responseFormat;
  const body = JSON.stringify(payload);

  const { status, text } = await requestJson(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body
  });

  if (status < 200 || status >= 300) {
    throw new Error(`AI 请求失败: ${status} ${text.slice(0, 500)}`);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`AI 返回非 JSON: ${text.slice(0, 200)}`);
  }

  const content =
    data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : '';
  return { mock: false, content, model };
}

/** 从可能带 markdown 包裹的文本中提取 JSON 对象 */
function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < 0) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch (e) {
    return null;
  }
}

module.exports = { chatCompletion, extractJson };
