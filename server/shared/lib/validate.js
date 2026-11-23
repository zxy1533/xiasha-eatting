'use strict';

const { CODES, AppError } = require('./errors');

const ID_RE = /^r_[0-9]{4,}$/;

/** openid is server-derived only; a supplied one is ignored and logged. */
function warnIfClientOpenid(input) {
  if (input && Object.prototype.hasOwnProperty.call(input, 'openid')) {
    console.warn('ignored client-supplied openid field');
    return true;
  }
  return false;
}

/** Boundary check: question must be a 1-200 char string (SPEC §5.2). */
function checkQuestion(value) {
  if (typeof value !== 'string' || value.trim().length < 1 || value.length > 200) {
    throw new AppError(CODES.BAD_INPUT, 'question must be 1-200 chars');
  }
  return value.trim();
}

/** Boundary check: exclude is an array of <=20 valid seed ids (SPEC §5.2). */
function checkExclude(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 20) {
    throw new AppError(CODES.BAD_INPUT, 'exclude must be an array of at most 20 ids');
  }
  for (const id of value) {
    if (typeof id !== 'string' || !ID_RE.test(id)) {
      throw new AppError(CODES.BAD_INPUT, 'exclude contains an invalid restaurant id');
    }
  }
  return [...new Set(value)];
}

/** Boundary check: avoid-lookup query must be 1-40 chars (SPEC §5.3). */
function checkQuery(value) {
  if (typeof value !== 'string' || value.trim().length < 1 || value.length > 40) {
    throw new AppError(CODES.BAD_INPUT, 'query must be 1-40 chars');
  }
  return value.trim();
}

/** Short, stable question form for cache keys and logs (never logged raw). */
const SYNONYMS = new Map([
  ['吃啥', '吃什么'], ['吃啥呀', '吃什么'], ['吃什么好', '吃什么'],
  ['啥好吃', '什么好吃'], ['哪吃', '哪里吃'], ['蛮好吃', '好吃'],
]);

function normalizeQuestion(value) {
  let text = String(value || '');
  if (typeof text.normalize === 'function') text = text.normalize('NFKC');
  text = text.toLowerCase().replace(/[\s\u3000]/g, '');
  text = text.replace(/[!！?？。,.，、~～…]+/g, '');
  for (const [from, to] of SYNONYMS) text = text.split(from).join(to);
  return text.slice(0, 200);
}

/** Name comparison used by the whitelist; full/half width and case insensitive. */
function normalizeName(value) {
  let text = String(value || '');
  if (typeof text.normalize === 'function') text = text.normalize('NFKC');
  return text.replace(/[\s\u3000]/g, '').toLowerCase();
}

// F7-d / AC-04 last line of defence: the model's answer must not carry PII.
const PII_PATTERNS = [
  /(?<!\d)1[3-9]\d{9}(?!\d)/,          // phone
  /(?<!\d)\d{8,12}(?!\d)/,             // student id
  /@[\w\u4e00-\u9fff-]{1,20}/,         // @nickname
  /\d{1,2}\s*[:：]\s*\d{2}/,          // minute-level time
];

function containsPII(text) {
  const value = String(text || '');
  return PII_PATTERNS.some((pattern) => pattern.test(value));
}

module.exports = {
  ID_RE,
  warnIfClientOpenid,
  checkQuestion,
  checkExclude,
  checkQuery,
  normalizeQuestion,
  normalizeName,
  containsPII,
};
