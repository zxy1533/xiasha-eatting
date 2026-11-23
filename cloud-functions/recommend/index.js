'use strict';

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const { resolveConfig } = require('../shared/lib/config');
const { warnIfClientOpenid } = require('../shared/lib/validate');
const { ok, normalizeError } = require('../shared/lib/errors');
const service = require('./service');
const { callLLM } = require('./llm');

// F7-e: the key lives only in the cloud environment; absence fails at cold
// start. Nothing in this file (or any client bundle) contains a key literal.
const config = resolveConfig(process.env);
const db = cloud.database();

// Thin entry: session -> validate -> delegate -> error normalization.
exports.main = async (event) => {
  try {
    const input = event || {};
    warnIfClientOpenid(input);
    const { OPENID } = cloud.getWXContext();
    const result = await service.recommend(input, {
      config, db, openid: OPENID, nowMs: Date.now(), llmFn: callLLM,
    });
    if (result && result.__degraded) {
      return {
        code: result.code,
        data: result.data,
        message: result.data.degrade_reason,
      };
    }
    return ok(result);
  } catch (err) {
    console.warn('recommend failed:', err && err.detail ? err.detail : err && err.name);
    return normalizeError(err);
  }
};
