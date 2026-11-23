'use strict';

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const { resolveConfig } = require('../shared/lib/config');
const { normalizeError, ok } = require('../shared/lib/errors');
const { warnIfClientOpenid } = require('../shared/lib/validate');
const service = require('./service');

// Config resolves at cold start: a bad limit or missing setting fails loudly.
const config = resolveConfig(process.env, { requireKey: false });
const db = cloud.database();

exports.main = async (event) => {
  try {
    const input = event || {};
    // A client-supplied openid is ignored. Only the session context counts.
    warnIfClientOpenid(input);
    const { OPENID } = cloud.getWXContext();
    const data = await service.checkUsage(OPENID, {
      db,
      config,
      nowMs: Date.now(),
    });
    return ok(data);
  } catch (err) {
    console.warn('usage-check failed:', err && err.detail ? err.detail : err && err.name);
    return normalizeError(err);
  }
};
