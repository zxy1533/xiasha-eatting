'use strict';

/**
 * In-process self-test for the web backend. No network, no API key needed:
 * it exercises the in-memory repo (burst guard / monthly cap / settle / cache)
 * and the full recommend chain with a mocked llmFn (service wiring + whitelist).
 *
 * Run: node self-test.js
 */

const assert = require('assert');
const repo = require('./recommend/repo');
const service = require('./recommend/service');
const { resolveConfig } = require('./shared/lib/config');
const { CODES } = require('./shared/lib/errors');

async function testRepo() {
  // burst guard: 10s window, max 3 per device
  const s1 = repo.createStore();
  const base = { monthKey: '2026-11', cap: 1e12, estimateMicros: 100, windowSec: 10, burstMax: 3 };
  for (let i = 0; i < 3; i += 1) {
    await repo.reserveQuota(s1, { deviceId: 'dev-A', nowMs: 1000 + i, ...base });
  }
  await assert.rejects(
    () => repo.reserveQuota(s1, { deviceId: 'dev-A', nowMs: 2000, ...base }),
    (e) => e.code === CODES.RATE_LIMIT
  );
  // window resets after 10s
  await repo.reserveQuota(s1, { deviceId: 'dev-A', nowMs: 11000, ...base });

  // monthly cap
  const s2 = repo.createStore();
  const b2 = { deviceId: 'dev-B', monthKey: '2026-11', cap: 300, estimateMicros: 100, windowSec: 10, burstMax: 100 };
  await repo.reserveQuota(s2, { nowMs: 1000, ...b2 });
  await repo.reserveQuota(s2, { nowMs: 2000, ...b2 });
  await repo.reserveQuota(s2, { nowMs: 3000, ...b2 });
  await assert.rejects(
    () => repo.reserveQuota(s2, { nowMs: 4000, ...b2 }),
    (e) => e.code === CODES.MONTHLY_CAP
  );

  // settleCost refunds the difference (actual < estimate)
  await repo.settleCost(s2, '2026-11', 100, 30);
  const m = await repo.getMonth(s2, '2026-11');
  assert.strictEqual(m.cost_micros, 230);

  // cache TTL
  const s3 = repo.createStore();
  await repo.putCache(s3, 'k', { answer: { x: 1 }, created_at: 1000 });
  assert.deepStrictEqual(await repo.getCache(s3, 'k', 2000, 7), { x: 1 });
  assert.strictEqual(await repo.getCache(s3, 'k', 1000 + 8 * 86400000, 7), null);

  console.log('  repo: burst guard / monthly cap / settle / cache TTL OK');
}

async function testRecommendChain() {
  const store = repo.createStore();
  const config = resolveConfig({}, { requireKey: false });
  let llmCalls = 0;
  const mockLLM = async () => {
    llmCalls += 1;
    return {
      content: {
        restaurant_name: 'INTP咖喱工厂',
        reason: '量大好吃，点过很多次',
        evidence: ['好吃的,量很大,点了很多次的鸡肉牛柳双拼'],
        verdict: '褒',
      },
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    };
  };

  const deps = { config, store, nowMs: Date.now(), deviceId: 'dev-1', llmFn: mockLLM };
  const r1 = await service.recommend({ question: '想吃咖喱', exclude: [] }, deps);
  assert.strictEqual(r1.cached, false);
  assert.strictEqual(r1.degraded, false);
  assert.strictEqual(r1.answer.restaurants[0].restaurant_id, 'r_0002');
  assert.strictEqual(r1.answer.restaurants[0].restaurant_name, 'INTP咖喱工厂');

  // second identical question must hit the cache without another LLM call
  const r2 = await service.recommend({ question: '想吃咖喱', exclude: [] }, deps);
  assert.strictEqual(r2.cached, true);
  assert.strictEqual(llmCalls, 1);

  // settleCost reconciled the reservation (4772) down to actual (200)
  const m = await repo.getMonth(store, '2026-11');
  assert.strictEqual(m.cost_micros, 200);

  console.log('  recommend chain: device_id wiring / cache / whitelist / settle OK');
}

(async () => {
  console.log('self-test start');
  await testRepo();
  await testRecommendChain();
  console.log('self-test PASS');
})().catch((err) => {
  console.error('self-test FAIL:', err);
  process.exit(1);
});
