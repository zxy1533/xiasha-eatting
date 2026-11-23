'use strict';

const repo = require('./repo');
const { shanghaiKeys } = require('../shared/lib/time');

/**
 * Read-only precheck. Does not decrement any counter (SPEC §5.1).
 * openid is supplied by the server entry point, never by the client.
 */
// Gate E26 justification: no OAuth state/PKCE flow exists. openid is taken
// from the server's WeChat session context, never from an authorization code.
// Gate E29 justification: this endpoint is read-only; the rate_limit burst
// guard for the paid endpoint is enforced atomically in recommend/repo.js.
async function checkUsage(openid, deps) {
  const { db, config, nowMs } = deps;
  const keys = shanghaiKeys(nowMs);
  const dailyId = `${openid}|${keys.dateKey}`;

  const [daily, month] = await Promise.all([
    repo.getOne(db, 'usage_daily', dailyId),
    repo.getOne(db, 'usage_month', keys.monthKey),
  ]);
  const used = daily ? Number(daily.count) || 0 : 0;
  const monthlyUsed = month ? Number(month.cost_micros) || 0 : 0;
  // LIMIT_DAILY === 0 表示不限每日次数；daily_remaining 返回 null 供前端隐藏剩余次数。
  const unlimited = config.LIMIT_DAILY <= 0;

  return {
    daily_limit: config.LIMIT_DAILY,
    daily_used: used,
    daily_remaining: unlimited ? null : Math.max(0, config.LIMIT_DAILY - used),
    monthly_cap_micros: config.MONTHLY_CAP_MICROS,
    monthly_used_micros: monthlyUsed,
    global_stopped: monthlyUsed >= config.MONTHLY_CAP_MICROS,
    reset_date_key: keys.nextDateKey,
  };
}

module.exports = { checkUsage };
