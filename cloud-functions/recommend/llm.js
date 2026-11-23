'use strict';

const https = require('https');
const { CODES, AppError } = require('../shared/lib/errors');

const MAX_RESPONSE_BYTES = 1024 * 1024;

function extractContent(payload) {
  const choice = payload && payload.choices && payload.choices[0];
  const text = choice && choice.message && choice.message.content;
  if (typeof text !== 'string') {
    throw new AppError(CODES.LLM_ERROR, 'empty model content');
  }
  let cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  cleaned = cleaned.trim();
  if (!cleaned.startsWith('{')) {
    throw new AppError(CODES.LLM_ERROR, 'model output is not JSON');
  }
  return JSON.parse(cleaned);
}

/** Integer micro-yuan cost from reported token usage. Never uses floats. */
function costFromUsage(usage, config) {
  const inTokens = Math.max(0, Number(usage && usage.prompt_tokens) || 0);
  const outTokens = Math.max(0, Number(usage && usage.completion_tokens) || 0);
  return (
    Math.ceil((inTokens * config.PRICE_IN_MICRO_PER_1K) / 1000) +
    Math.ceil((outTokens * config.PRICE_OUT_MICRO_PER_1K) / 1000)
  );
}

/**
 * Native HTTPS call to the OpenAI-compatible endpoint. No third-party SDK,
 * no retry (paid call), explicit connect/read timeouts with outer > inner.
 * The API key is read from config (process.env) and never logged.
 */
function callLLM(config, messages) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let connectTimer = null;
    let readTimer = null;

    const failOnce = (code, detail) => {
      if (settled) return;
      settled = true;
      if (connectTimer) clearTimeout(connectTimer);
      if (readTimer) clearTimeout(readTimer);
      reject(new AppError(code, detail));
    };

    let url;
    try {
      url = new URL(config.LLM_BASE_URL);
    } catch (err) {
      return failOnce(CODES.CONFIG_ERROR, 'LLM_BASE_URL invalid');
    }

    // thinking ON: the user explicitly wants the model to reason first, then
    // search the store data, then answer. Reasoning tokens are billed as
    // output, so we give it a bounded budget (max_tokens covers thinking +
    // answer). temperature has no effect in thinking mode.
    const body = JSON.stringify({
      model: config.LLM_MODEL,
      messages,
      temperature: 0.2,
      max_tokens: 4000,
      stream: false,
      thinking: { type: 'enabled' },
    });

    const req = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.LLM_API_KEY}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        if (connectTimer) clearTimeout(connectTimer);
        const status = res.statusCode || 0;
        if (status < 200 || status >= 300) {
          res.resume();
          return failOnce(CODES.LLM_ERROR, `upstream_http_${status}`);
        }
        let raw = '';
        readTimer = setTimeout(() => {
          res.destroy();
          failOnce(CODES.LLM_ERROR, 'upstream_read_timeout');
        }, config.LLM_READ_TIMEOUT_MS);
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
          if (raw.length > MAX_RESPONSE_BYTES) {
            res.destroy();
            failOnce(CODES.LLM_ERROR, 'upstream_response_too_large');
          }
        });
        res.on('error', () => failOnce(CODES.LLM_ERROR, 'upstream_stream_error'));
        res.on('end', () => {
          if (settled) return;
          settled = true;
          if (readTimer) clearTimeout(readTimer);
          try {
            const payload = JSON.parse(raw);
            const content = extractContent(payload);
            // Only status and token counts are logged; never the body or key.
            console.log('llm ok', JSON.stringify({ status, usage: payload.usage || {} }));
            resolve({ content, usage: payload.usage || {} });
          } catch (err) {
            reject(new AppError(CODES.LLM_ERROR, 'upstream_invalid_json'));
          }
        });
      }
    );

    connectTimer = setTimeout(() => {
      req.destroy();
      failOnce(CODES.LLM_ERROR, 'upstream_connect_timeout');
    }, config.LLM_CONNECT_TIMEOUT_MS);
    req.on('error', (err) => {
      failOnce(CODES.LLM_ERROR, `upstream_request_${err && err.code ? err.code : 'error'}`);
    });
    req.write(body);
    req.end();
  });
}

module.exports = { callLLM, costFromUsage, extractContent };
