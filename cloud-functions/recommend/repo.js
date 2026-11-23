'use strict';

const { CODES, AppError } = require('../shared/lib/errors');

async function getOne(db, collection, id) {
  const res = await db.collection(collection).where({ _id: id }).limit(1).get();
  return res && res.data && res.data[0] ? res.data[0] : null;
}

function getDaily(db, id) { return getOne(db, 'usage_daily', id); }
function getMonth(db, id) { return getOne(db, 'usage_month', id); }

/**
 * Atomically reserve one call: daily count, monthly cost and burst counters
 * move together in one DB transaction. If ANY guard fails, rollback and throw
 * before the paid LLM request is made (SPEC §4.1 / F7-a/b/f).
 */
async function reserveQuota(db, p) {
  const _ = db.command || {};
  const tx = await db.startTransaction();
  try {
    let daily = await getOne(tx, 'usage_daily', p.dailyId);
    let month = await getOne(tx, 'usage_month', p.monthKey);

    if (!daily) {
      daily = {
        _id: p.dailyId, openid: p.openid, count: 0,
        last_request_ms: 0, burst_window_start_ms: 0, burst_count: 0,
      };
      await tx.collection('usage_daily').add({ data: { ...daily, updated_at: p.nowMs } });
    }
    if (!month) {
      month = { _id: p.monthKey, cost_micros: 0, calls: 0 };
      await tx.collection('usage_month').add({ data: { ...month, updated_at: p.nowMs } });
    }

    const used = Number(daily.count) || 0;
    // limit === Infinity 表示不限每日次数（LIMIT_DAILY=0）；仍累加 count 供观测，
    // 但永不因每日次数拒绝。月度封顶与突发闸仍然生效。
    const limited = Number.isFinite(p.limit);
    if (limited && used >= p.limit) throw new AppError(CODES.DAILY_LIMIT);
    const monthlyUsed = Number(month.cost_micros) || 0;
    if (monthlyUsed + p.estimateMicros > p.cap) {
      throw new AppError(CODES.MONTHLY_CAP);
    }

    // 10-second sliding window, <=3 requests (F7-f). CAS must compare against
    // the STORED window start, then write the new one; comparing against the
    // new value would match 0 rows on a brand-new document.
    const windowMs = p.windowSec * 1000;
    const storedStart = Number(daily.burst_window_start_ms) || 0;
    const storedCount = Number(daily.burst_count) || 0;
    const resetting = !storedStart || p.nowMs - storedStart >= windowMs;
    const burstStart = resetting ? p.nowMs : storedStart;
    const burstCount = resetting ? 0 : storedCount;
    if (burstCount >= p.burstMax) throw new AppError(CODES.RATE_LIMIT);

    // Compare-and-swap guards: if a concurrent request changed either row
    // after our read, the conditional UPDATE affects 0 rows and we abort.
    const dailyWhere = {
      _id: p.dailyId,
      burst_window_start_ms: storedStart,
    };
    if (limited) dailyWhere.count = _.lt(p.limit);
    if (!resetting) dailyWhere.burst_count = _.lt(p.burstMax);
    const dailyUpdate = await tx.collection('usage_daily').where(dailyWhere).update({
      data: {
        count: _.inc(1),
        last_request_ms: p.nowMs,
        burst_window_start_ms: burstStart,
        burst_count: resetting ? 1 : _.inc(1),
        updated_at: p.nowMs,
      },
    });
    if (!dailyUpdate || !dailyUpdate.stats || dailyUpdate.stats.updated < 1) {
      throw new AppError(CODES.DAILY_LIMIT);
    }

    const monthUpdate = await tx.collection('usage_month').where({
      _id: p.monthKey,
      cost_micros: _.lte(p.cap - p.estimateMicros),
    }).update({
      data: {
        cost_micros: _.inc(p.estimateMicros),
        calls: _.inc(1),
        updated_at: p.nowMs,
      },
    });
    if (!monthUpdate || !monthUpdate.stats || monthUpdate.stats.updated < 1) {
      throw new AppError(CODES.MONTHLY_CAP);
    }

    await tx.commit();
    return {
      dailyRemaining: limited ? Math.max(0, p.limit - (used + 1)) : null,
      monthlyUsed: monthlyUsed + p.estimateMicros,
    };
  } catch (err) {
    try { await tx.rollback(); } catch (rbErr) {
      console.warn('reserveQuota rollback failed:', rbErr && rbErr.name);
    }
    throw err;
  }
}

/** Reconcile the reserved upper bound with the real token usage (integer only). */
async function settleCost(db, monthKey, estimatedMicros, actualMicros, nowMs) {
  const delta = Math.max(0, Math.min(estimatedMicros, actualMicros)) - estimatedMicros;
  if (delta === 0) return;
  const _ = db.command || {};
  await db.collection('usage_month').where({ _id: monthKey }).update({
    data: { cost_micros: _.inc(delta), updated_at: nowMs },
  });
}

async function getCache(db, key, nowMs, ttlDays) {
  const row = await getOne(db, 'reason_cache', key);
  if (!row) return null;
  const ageMs = nowMs - Number(row.created_at || 0);
  if (ageMs < 0 || ageMs > ttlDays * 24 * 60 * 60 * 1000) return null;
  return row.answer || null;
}

/** Upsert by primary key; concurrent writers with the same key are idempotent. */
async function putCache(db, key, payload) {
  await db.collection('reason_cache').doc(key).set({ data: payload });
}

module.exports = {
  getOne, getDaily, getMonth, reserveQuota, settleCost, getCache, putCache,
};
