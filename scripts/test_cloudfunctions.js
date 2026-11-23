'use strict';

/**
 * Black-box tests for cloud functions using injected mocks. No wx-server-sdk
 * and no network: service/repo/whitelist are exercised directly from the
 * contract (SPEC §5-§8), not from their own implementation details.
 */
const assert = require('assert');
const path = require('path');

const CF = path.join(__dirname, '..', 'cloud-functions');
const { resolveConfig } = require(path.join(CF, 'shared/lib/config'));
const { CODES } = require(path.join(CF, 'shared/lib/errors'));
const dataRepo = require(path.join(CF, 'shared/lib/data'));
const { shanghaiKeys } = require(path.join(CF, 'shared/lib/time'));
const avoidService = require(path.join(CF, 'avoid-lookup/service'));
const usageService = require(path.join(CF, 'usage-check/service'));
const recommendService = require(path.join(CF, 'recommend/service'));
const { validateAnswer } = require(path.join(CF, 'recommend/whitelist'));
const { projectRestaurants, buildCacheKey, WHITELIST_FIELDS } = require(path.join(CF, 'recommend/prompt'));

const ENV = { LLM_API_KEY: 'test-placeholder-only', DATA_VERSION: '1', PROMPT_VERSION: 'v1' };
const CONFIG = resolveConfig(ENV);
const NOW = Date.parse('2026-11-22T12:00:00Z'); // = 2026-11-22 20:00 Asia/Shanghai

const { MockDB } = require('./mock_cloud_db');

const seed = dataRepo.loadSeed();
const keys = shanghaiKeys(NOW);
const OPENID = 'openid-test-user';
const DAILY_ID = `${OPENID}|${keys.dateKey}`;

function makeDaily(overrides) {
  return {
    _id: DAILY_ID, openid: OPENID, count: 0, last_request_ms: 0,
    burst_window_start_ms: 0, burst_count: 0, ...overrides,
  };
}

function depsFor(db, llmFn) {
  return { config: CONFIG, db, nowMs: NOW, openid: OPENID, llmFn, seed };
}

function pickSafeContent(hits) {
  const allNames = seed.filter((r) => r.name.length >= 4).map((r) => r.name);
  for (const row of hits) {
    for (const quote of row.evidence) {
      const quoteHasOtherStore = allNames.some(
        (name) => name !== row.name && quote.includes(name)
      );
      if (!quoteHasOtherStore) {
        return {
          restaurant_name: row.name,
          reason: `按你说的需求，这家合适：${quote}`,
          evidence: [quote],
          verdict: row.verdict,
        };
      }
    }
  }
  throw new Error('no safe content found in seed');
}

function makeLLM(content, calls) {
  return async (_config, _messages) => {
    calls.push(_messages);
    return {
      content,
      usage: { prompt_tokens: 1000, completion_tokens: 100 },
    };
  };
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------
const tests = [];
function test(name, fn) { tests.push([name, fn]); }

test('avoid-lookup: real store returns verdict and no model call', () => {
  const store = seed.find((row) => row.name === '纸包鸡');
  const result = avoidService.lookup('纸包鸡');
  assert.strictEqual(result.found, true);
  assert.ok(result.matches.some((m) => m.id === store.id));
  assert.ok(result.matches[0].evidence.length >= 1);
});

test('avoid-lookup: unknown store returns found=false', () => {
  const result = avoidService.lookup('不存在的店XYZ');
  assert.strictEqual(result.found, false);
  assert.deepStrictEqual(result.matches, []);
});

test('whitelist: library-external restaurant name is rejected with 50002', () => {
  const hits = recommendService.recall('想吃辣的', [], 8, seed).hits;
  const safe = pickSafeContent(hits);
  let thrown = null;
  try {
    validateAnswer({ ...safe, restaurant_name: '不存在的店XYZ' }, hits, seed);
  } catch (err) { thrown = err; }
  assert.ok(thrown, 'expected validation failure');
  assert.strictEqual(thrown.code, CODES.WHITELIST_FAIL);
});

test('whitelist: forged id outside hit set is rejected', () => {
  const hits = recommendService.recall('想吃辣的', [], 8, seed).hits;
  const safe = pickSafeContent(hits);
  assert.throws(
    () => validateAnswer({ ...safe, restaurant_id: 'r_9999' }, hits, seed),
    (err) => err.code === CODES.WHITELIST_FAIL
  );
});

test('prompt projection: exactly 5 fields, max 2 evidence quotes', () => {
  const projected = projectRestaurants(seed.slice(0, 10));
  assert.ok(projected.length > 0);
  for (const row of projected) {
    assert.deepStrictEqual(Object.keys(row).sort(), [...WHITELIST_FIELDS].sort());
    assert.ok(row.evidence.length <= 2);
    assert.strictEqual(row.id, undefined);
    assert.strictEqual(row.source_sheet, undefined);
  }
});

test('cache key: different hit sets, excludes and versions never collide', () => {
  const q = '晚上想吃什么';
  const base = buildCacheKey(q, ['r_0001', 'r_0002'], [], CONFIG);
  assert.strictEqual(base, buildCacheKey(q, ['r_0002', 'r_0001'], [], CONFIG));
  assert.notStrictEqual(base, buildCacheKey(q, ['r_0001', 'r_0003'], [], CONFIG));
  assert.notStrictEqual(base, buildCacheKey(q, ['r_0001', 'r_0002'], ['r_0007'], CONFIG));
  assert.notStrictEqual(
    base,
    buildCacheKey(q, ['r_0001', 'r_0002'], [], { ...CONFIG, DATA_VERSION: 2 })
  );
  assert.notStrictEqual(base, buildCacheKey('中午想吃什么', ['r_0001', 'r_0002'], [], CONFIG));
});

test('quota: daily limit disabled (LIMIT_DAILY=0) — no daily cap, LLM still runs', async () => {
  // 取消每日限次后，即使当天已累计 10 次，也不应再被每日限次拦截；
  // 月度封顶与突发闸仍由 reserveQuota 兜底。
  const db = new MockDB({ usage_daily: { [DAILY_ID]: makeDaily({ count: 10 }) } });
  const calls = [];
  const hits = recommendService.recall('想吃辣的', [], 8, seed).hits;
  const result = await recommendService.recommend(
    { question: '想吃辣的' }, depsFor(db, makeLLM(pickSafeContent(hits), calls))
  );
  assert.strictEqual(result.degraded, false);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(db.store.usage_daily[DAILY_ID].count, 11); // 仍累加观测
});

test('quota: month at cap returns 40302 and calls no model', async () => {
  const db = new MockDB({
    usage_month: { [keys.monthKey]: { _id: keys.monthKey, cost_micros: CONFIG.MONTHLY_CAP_MICROS, calls: 9 } },
  });
  const calls = [];
  const result = await recommendService.recommend(
    { question: '晚上吃什么' }, depsFor(db, makeLLM(null, calls))
  );
  assert.strictEqual(result.code, CODES.MONTHLY_CAP);
  assert.strictEqual(calls.length, 0);
});

test('rate limit: 3 requests in 10s window returns 42901, no model call', async () => {
  const db = new MockDB({
    usage_daily: {
      [DAILY_ID]: makeDaily({
        count: 3, burst_window_start_ms: NOW - 1000, burst_count: 3,
      }),
    },
  });
  const calls = [];
  let thrown = null;
  try {
    await recommendService.recommend({ question: '晚上吃什么' }, depsFor(db, makeLLM(null, calls)));
  } catch (err) { thrown = err; }
  assert.ok(thrown);
  assert.strictEqual(thrown.code, CODES.RATE_LIMIT);
  assert.strictEqual(calls.length, 0);
});

test('happy path then cache hit: second call makes no model request and no extra charge', async () => {
  const db = new MockDB({});
  const hits = recommendService.recall('想吃辣的', [], 8, seed).hits;
  const calls = [];
  const llm = makeLLM(pickSafeContent(hits), calls);
  const deps = depsFor(db, llm);

  const first = await recommendService.recommend({ question: '想吃辣的' }, deps);
  assert.strictEqual(first.degraded, false);
  assert.strictEqual(first.cached, false);
  // answer is now { summary, restaurants:[...] } (multi-store shape).
  assert.ok(first.answer && Array.isArray(first.answer.restaurants) && first.answer.restaurants.length > 0);
  assert.ok(hits.some((row) => row.id === first.answer.restaurants[0].restaurant_id));
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(db.store.usage_daily[DAILY_ID].count, 1);
  // 1000 in-tokens + 100 out-tokens, integer micros. Compute from CONFIG so a
  // price change (e.g. DeepSeek V4-Flash rate card) doesn't break this test.
  const expectedCost = Math.ceil(1000 * CONFIG.PRICE_IN_MICRO_PER_1K / 1000) +
    Math.ceil(100 * CONFIG.PRICE_OUT_MICRO_PER_1K / 1000);
  assert.strictEqual(db.store.usage_month[keys.monthKey].cost_micros, expectedCost);
  assert.ok(Object.keys(db.store.reason_cache).length === 1);

  const second = await recommendService.recommend({ question: '想吃辣的' }, deps);
  assert.strictEqual(second.cached, true);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(db.store.usage_daily[DAILY_ID].count, 1);
  assert.strictEqual(db.store.usage_month[keys.monthKey].cost_micros, expectedCost);
});

test('LLM failure: 50001, cost refunded, exactly one attempt (zero retry)', async () => {
  const db = new MockDB({});
  let attempts = 0;
  const failing = async () => { attempts += 1; throw new Error('upstream down'); };
  let thrown = null;
  try {
    await recommendService.recommend({ question: '晚上吃什么' }, depsFor(db, failing));
  } catch (err) { thrown = err; }
  assert.ok(thrown);
  assert.strictEqual(attempts, 1);
  assert.strictEqual(db.store.usage_month[keys.monthKey].cost_micros, 0);
  assert.strictEqual(db.store.usage_daily[DAILY_ID].count, 1);
});

test('usage-check: read-only and Shanghai day boundary', async () => {
  const db = new MockDB({
    usage_daily: { [DAILY_ID]: makeDaily({ count: 3 }) },
    usage_month: { [keys.monthKey]: { _id: keys.monthKey, cost_micros: 9900000, calls: 3 } },
  });
  const result = await usageService.checkUsage(OPENID, { db, config: CONFIG, nowMs: NOW });
  assert.strictEqual(result.daily_used, 3);
  assert.strictEqual(result.daily_remaining, null); // LIMIT_DAILY=0 → 不限每日次数
  assert.strictEqual(result.monthly_used_micros, 9900000);
  assert.strictEqual(result.global_stopped, false);
  assert.strictEqual(result.reset_date_key, shanghaiKeys(NOW).nextDateKey);
  assert.strictEqual(db.store.usage_daily[DAILY_ID].count, 3); // unchanged
  assert.strictEqual(keys.dateKey, '2026-11-22');
});

test('config: missing LLM_API_KEY fails loudly', () => {
  assert.throws(() => resolveConfig({}), (err) => err.code === CODES.CONFIG_ERROR);
});

(async () => {
  let passed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log(`PASS  ${name}`); passed += 1; }
    catch (err) { console.error(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`); }
  }
  console.log(`\n${passed}/${tests.length} cloud-function tests passed`);
  if (passed !== tests.length) process.exit(1);
})();
