'use strict';

const repo = require('../recommend/repo');
const { shanghaiKeys } = require('../shared/lib/time');

/**
 * Read-only precheck. Does not decrement any counter.
 * The per-user daily limit was removed (LIMIT_DAILY=0), so only the global
 * monthly usage is reported. daily_* fields are kept for frontend contract
 * compatibility and returned as null/0 ("unlimited").
 */
async function checkUsage(deps) {
  const { config, store, nowMs } = deps;
  const keys = shanghaiKeys(nowMs);

  const month = await repo.getMonth(store, keys.monthKey);
  const monthlyUsed = month ? Number(month.cost_micros) || 0 : 0;

  return {
    daily_limit: 0,        // 0 = unlimited
    daily_used: 0,
    daily_remaining: null, // null = unlimited (frontend hides it)
    monthly_cap_micros: config.MONTHLY_CAP_MICROS,
    monthly_used_micros: monthlyUsed,
    global_stopped: monthlyUsed >= config.MONTHLY_CAP_MICROS,
    reset_date_key: keys.nextDateKey,
  };
}

module.exports = { checkUsage };
