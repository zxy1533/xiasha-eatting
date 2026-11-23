'use strict';

// Unified error envelope. SPEC §5.4 is the only outward error representation;
// a caller never has to guess which layer threw (runtime-defensive.md §三.2).
const CODES = Object.freeze({
  OK: 0,
  BAD_INPUT: 40001,
  DAILY_LIMIT: 40301,
  MONTHLY_CAP: 40302,
  NOT_FOUND: 40401,
  RATE_LIMIT: 42901,
  LLM_ERROR: 50001,
  WHITELIST_FAIL: 50002,
  CONFIG_ERROR: 50003,
});

const MESSAGES = Object.freeze({
  [CODES.BAD_INPUT]: '换个说法试试',
  [CODES.DAILY_LIMIT]: '今天问的次数用完啦，明天再来',
  [CODES.MONTHLY_CAP]: '本月额度已用完，查店名还能继续用',
  [CODES.NOT_FOUND]: '表里没有这家',
  [CODES.RATE_LIMIT]: '慢一点再问',
  [CODES.LLM_ERROR]: '服务有点忙，稍后再试',
  [CODES.WHITELIST_FAIL]: '这次没挑出来，换个说法',
  [CODES.CONFIG_ERROR]: '服务暂不可用',
});

class AppError extends Error {
  constructor(code, detail) {
    super(MESSAGES[code] || '服务暂不可用');
    this.name = 'AppError';
    this.code = code;
    // detail is for structured logs only; never sent to the client.
    this.detail = detail || '';
  }
}

function ok(data) {
  return { code: CODES.OK, data: data || {}, message: '' };
}

function fail(code, message) {
  return {
    code,
    data: {},
    message: message || MESSAGES[code] || '服务暂不可用',
  };
}

function normalizeError(err) {
  if (err instanceof AppError) {
    return fail(err.code, err.message);
  }
  // Unknown failures never leak a stack or request body to the client.
  return fail(CODES.LLM_ERROR, MESSAGES[CODES.LLM_ERROR]);
}

module.exports = { CODES, MESSAGES, AppError, ok, fail, normalizeError };
