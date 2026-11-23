'use strict';

const { CODES, AppError } = require('./errors');
const { loadLocalEnv } = require('./env');

// For local/CLI verification only. On WeChat Cloud the key is injected as a
// real env var and loadLocalEnv is a no-op (no .env file is deployed).
// Search from this module and from the recommend function dir (where .env lives).
loadLocalEnv(__dirname);
loadLocalEnv(require('path').join(__dirname, '..', '..', 'recommend'));

// Every knob has one explicit default (SPEC §10.2). Bound-check at cold start
// so a typo fails loudly instead of silently changing spend
// (runtime-defensive.md: "配置错必须大声失败").
const NUMERIC_RULES = {
  // 0 = 不限每日次数（保留月度封顶 + 突发闸作护栏）。
  LIMIT_DAILY: { def: 0, min: 0, max: 1000000 },
  MONTHLY_CAP_MICROS: { def: 300000000, min: 1000000, max: 1000000000 },
  // DeepSeek V4-Flash (verified 2026-11-23, api-docs.deepseek.com pricing):
  // input $0.14/1M, output $0.28/1M; cache-hit input $0.0028/1M.
  // At ~7.1 CNY/USD: input ¥0.000994/1K, output ¥0.001988/1K (micro-yuan).
  // Rounded to 994 / 1988 micro-yuan per 1K. Over-estimates cache-hit input
  // on purpose (upper bound), which only makes the budget guard safer.
  PRICE_IN_MICRO_PER_1K: { def: 994, min: 1, max: 10000000 },
  PRICE_OUT_MICRO_PER_1K: { def: 1988, min: 1, max: 10000000 },
  RECALL_LIMIT: { def: 8, min: 1, max: 20 },
  CACHE_TTL_DAYS: { def: 7, min: 1, max: 30 },
  BUST_WINDOW_SEC: { def: 10, min: 1, max: 3600 },
  BUST_MAX: { def: 3, min: 1, max: 100 },
  DATA_VERSION: { def: 1, min: 1, max: 1000000 },
  LLM_CONNECT_TIMEOUT_MS: { def: 5000, min: 100, max: 30000 },
  LLM_READ_TIMEOUT_MS: { def: 30000, min: 100, max: 60000 },
};

const STRING_RULES = {
  LLM_MODEL: { def: 'deepseek-v4-flash', min: 1 },
  PROMPT_VERSION: { def: 'v1', min: 1 },
  LLM_BASE_URL: { def: 'https://api.deepseek.com/v1/chat/completions', min: 8 },
};

function readNumber(env, key, rule) {
  const raw = env[key];
  if (raw === undefined || raw === '') return rule.def;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < rule.min || value > rule.max) {
    throw new AppError(
      CODES.CONFIG_ERROR,
      `${key} must be an integer in [${rule.min}, ${rule.max}], got ${raw}`
    );
  }
  return value;
}

function readString(env, key, rule) {
  const raw = env[key];
  if (raw === undefined || raw === '') return rule.def;
  if (typeof raw !== 'string' || raw.trim().length < rule.min) {
    throw new AppError(CODES.CONFIG_ERROR, `${key} must be a non-empty string`);
  }
  return raw.trim();
}

/**
 * Resolve and freeze configuration.
 * @param {Record<string,string>} env process.env (or an injected test env)
 * @param {{requireKey?: boolean}} opts avoid-lookup/usage-check don't need a key
 */
function resolveConfig(env, opts) {
  const options = opts || {};
  const requireKey = options.requireKey !== false;
  const config = {};

  for (const [key, rule] of Object.entries(NUMERIC_RULES)) {
    config[key] = readNumber(env, key, rule);
  }
  for (const [key, rule] of Object.entries(STRING_RULES)) {
    config[key] = readString(env, key, rule);
  }

  // The key is read but never echoed in an error or a log line.
  const key = env.LLM_API_KEY;
  if (requireKey && (typeof key !== 'string' || key.trim() === '')) {
    throw new AppError(CODES.CONFIG_ERROR, 'LLM_API_KEY missing from environment');
  }
  config.LLM_API_KEY = typeof key === 'string' ? key : '';
  // Upper-bound reservation: 4000 input + 400 output tokens (SPEC §8.2).
  config.MAX_CALL_MICROS =
    Math.ceil(4000 * config.PRICE_IN_MICRO_PER_1K / 1000) +
    Math.ceil(400 * config.PRICE_OUT_MICRO_PER_1K / 1000);

  return Object.freeze(config);
}

module.exports = { resolveConfig, NUMERIC_RULES, STRING_RULES };
