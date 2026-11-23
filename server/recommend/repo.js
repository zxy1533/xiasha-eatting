'use strict';

const { CODES, AppError } = require('../shared/lib/errors');

/**
 * In-memory quota/cache/burst store — replaces the WeChat cloud database
 * (db.collection / db.command / db.startTransaction) for the web backend.
 *
 * Accepted trade-off (user approved): state is lost on process restart.
 * - monthly cost is a global single row keyed by monthKey
 * - reason cache is a Map with TTL (disposable data)
 * - burst guard is a per-device sliding window
 *
 * All mutations happen in the synchronous section of the Node.js event loop,
 * so the compare-and-swap / transaction the cloud DB needed is unnecessary:
 * a single process serialises these updates for free.
 */

function createStore() {
  return {
    months: new Map(), // monthKey -> { cost_micros, calls }
    cache: new Map(),  // cacheKey -> payload (has .answer and .created_at)
    burst: new Map(),  // deviceId -> { windowStart, count }
  };
}

async function getMonth(store, monthKey) {
  return store.months.get(monthKey) || null;
}

/**
 * Atomically reserve one call: monthly cost and per-device burst counters move
 * together. If either guard fails, throw BEFORE the paid LLM request is made.
 * Daily per-user limit was removed (LIMIT_DAILY=0), so only these two remain.
 */
async function reserveQuota(store, p) {
  // F7-f: 10-second sliding window, <= burstMax requests per device.
  const windowMs = p.windowSec * 1000;
  const now = p.nowMs;
  const current = store.burst.get(p.deviceId);
  const resetting = !current || now - current.windowStart >= windowMs;
  const count = resetting ? 0 : current.count;
  if (count >= p.burstMax) {
    throw new AppError(CODES.RATE_LIMIT);
  }
  store.burst.set(p.deviceId, {
    windowStart: resetting ? now : current.windowStart,
    count: count + 1,
  });

  // F7-b: global monthly cap, checked against the reserved upper bound.
  let month = store.months.get(p.monthKey);
  if (!month) {
    month = { cost_micros: 0, calls: 0 };
  }
  if (month.cost_micros + p.estimateMicros > p.cap) {
    // Roll the burst counter back before failing, so a capped month does not
    // also eat the device's burst allowance.
    store.burst.set(p.deviceId, { windowStart: resetting ? now : current.windowStart, count });
    throw new AppError(CODES.MONTHLY_CAP);
  }
  month.cost_micros += p.estimateMicros;
  month.calls += 1;
  store.months.set(p.monthKey, month);

  return { monthlyUsed: month.cost_micros };
}

/**
 * Reconcile the reserved upper bound with the real token usage (integer only).
 * delta is <= 0: it refunds the difference when the real cost is lower than
 * the estimate (or a full refund on LLM failure).
 */
async function settleCost(store, monthKey, estimatedMicros, actualMicros) {
  const delta = Math.max(0, Math.min(estimatedMicros, actualMicros)) - estimatedMicros;
  if (delta === 0) return;
  const month = store.months.get(monthKey);
  if (!month) return;
  month.cost_micros += delta;
  if (month.cost_micros < 0) month.cost_micros = 0;
}

async function getCache(store, key, nowMs, ttlDays) {
  const row = store.cache.get(key);
  if (!row) return null;
  const ageMs = nowMs - Number(row.created_at || 0);
  if (ageMs < 0 || ageMs > ttlDays * 24 * 60 * 60 * 1000) {
    store.cache.delete(key);
    return null;
  }
  return row.answer || null;
}

/** Upsert by key; concurrent writers with the same key are idempotent. */
async function putCache(store, key, payload) {
  store.cache.set(key, payload);
}

module.exports = {
  createStore,
  getMonth,
  reserveQuota,
  settleCost,
  getCache,
  putCache,
};
