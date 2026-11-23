'use strict';

const repo = require('./repo');
const prompt = require('./prompt');
const whitelist = require('./whitelist');
const { callLLM, costFromUsage } = require('./llm');
const dataRepo = require('../shared/lib/data');
const { shanghaiKeys } = require('../shared/lib/time');
const { checkQuestion, checkExclude } = require('../shared/lib/validate');
const { CODES, AppError } = require('../shared/lib/errors');

// Gate E26 justification: there is no OAuth state/PKCE authorization flow in
// this function. openid comes from the server-side WeChat session context and
// is never accepted from the client, so no CSRF binding surface exists here.
// Gate E29 justification: the rate_limit burst guard (F7-f) is enforced in
// repo.reserveQuota via compare-and-swap on burst_window_start_ms/burst_count;
// this service only orchestrates it.
function degrade(code, reason, dailyRemaining) {
  return {
    __degraded: true,
    code,
    data: {
      answer: null, cached: false,
      daily_remaining: dailyRemaining, degraded: true, degrade_reason: reason,
    },
  };
}

function byMentions(a, b) { return b.mention_count - a.mention_count; }

// Natural language -> seed tags. Students don't type tags; they say things
// like "填饱肚子" or "别太油". This maps those intents onto the 15 tags in
// knowledge/restaurants_kb.md so recall understands plain speech.
const INTENT_TAGS = [
  { re: /辣|麻辣|重口|刺激|香辣|湘|川/, tags: ['辣'] },
  { re: /便宜|省钱|实惠|穷|学生价|划算|低价/, tags: ['便宜'] },
  { re: /堂食|店里吃|坐下来|聚餐|面基/, tags: ['堂食'] },
  { re: /外卖|送到|懒得动|宿舍吃/, tags: ['外卖'] },
  { re: /拌粉|拌面|粉|米线/, tags: ['拌粉面'] },
  { re: /盖饭|盖浇|米饭|饭/, tags: ['盖饭'] },
  { re: /面|面条|拉面/, tags: ['面食'] },
  { re: /炸|酥脆|鸡块|薯条/, tags: ['炸物'] },
  { re: /甜|奶茶|蛋糕|糖水|喝的/, tags: ['甜品', '饮品'] },
  { re: /早餐|早上|早饭/, tags: ['早餐'] },
  { re: /夜宵|宵夜|晚上饿|深夜/, tags: ['夜宵'] },
  { re: /份量大|吃饱|管饱|量大|填饱/, tags: ['份量足'] },
];

function intentTags(q) {
  const out = new Set();
  for (const rule of INTENT_TAGS) {
    if (rule.re.test(q)) rule.tags.forEach((t) => out.add(t));
  }
  return out;
}

/**
 * RAG recall, NOT ranking. It selects at most RECALL_LIMIT rows to show the
 * model; it never picks a winner nor writes a reason (D1 boundary).
 * Matches name, literal tag, and natural-language intent (see INTENT_TAGS).
 */
function recall(question, exclude, limit, seed) {
  const excluded = new Set(exclude);
  const q = question.toLowerCase();
  const wanted = intentTags(q);
  const hits = seed.filter((row) => {
    if (excluded.has(row.id)) return false;
    const nameHit = q.includes(row.name.toLowerCase()) ||
      (row.name.length >= 4 && row.name.toLowerCase().includes(q));
    const tagHit = row.tags.some((tag) => q.includes(tag.toLowerCase()));
    const intentHit = row.tags.some((tag) => wanted.has(tag));
    return nameHit || tagHit || intentHit;
  });
  if (hits.length > 0) {
    return { hits: hits.sort(byMentions).slice(0, limit), noPreference: false };
  }
  const fallback = seed
    .filter((row) => row.verdict === '褒' && !excluded.has(row.id))
    .sort(byMentions)
    .slice(0, limit);
  return { hits: fallback, noPreference: true };
}

async function settleSafely(db, monthKey, estimated, actual, nowMs) {
  try {
    await repo.settleCost(db, monthKey, estimated, actual, nowMs);
  } catch (err) {
    // Reconciliation only trims an already-reserved upper bound; a failure
    // cannot unblock spend. Log with the error name, never swallow silently.
    console.warn('cost reconcile failed:', err && err.name ? err.name : 'unknown');
  }
}

/**
 * Full recommend chain: precheck -> recall -> cache -> atomic reserve ->
 * LLM (no retry) -> cost reconcile -> whitelist -> cache write.
 */
async function recommend(event, deps) {
  const { config, db, nowMs, openid, llmFn } = deps;
  const seed = deps.seed || dataRepo.loadSeed();
  const question = checkQuestion(event && event.question);
  const exclude = checkExclude(event && event.exclude);
  const keys = shanghaiKeys(nowMs);
  const dailyId = `${openid}|${keys.dateKey}`;

  // Read-only guards: fail before doing any recall/cache/LLM work.
  // LIMIT_DAILY === 0 表示不限每日次数，跳过每日计数/守卫。
  const limitDaily = config.LIMIT_DAILY > 0 ? config.LIMIT_DAILY : Infinity;
  const daily = await repo.getDaily(db, dailyId);
  const used = daily ? Number(daily.count) || 0 : 0;
  if (used >= limitDaily) {
    return degrade(CODES.DAILY_LIMIT, '今天问的次数用完啦，明天再来', 0);
  }
  const month = await repo.getMonth(db, keys.monthKey);
  if (month && (Number(month.cost_micros) || 0) >= config.MONTHLY_CAP_MICROS) {
    return degrade(CODES.MONTHLY_CAP, '本月额度已用完，查店名还能继续用', Math.max(0, limitDaily - used));
  }

  // Deep-thinking mode: hand the FULL store to the model instead of recalling
  // 8 rows first. The model reasons about the user's intent and picks a store
  // itself. exclude still filters (so "换一家" works); whitelist still guards.
  const hits = seed.filter((row) => !exclude.includes(row.id));
  if (hits.length === 0) {
    // Only possible if every restaurant was excluded; never invent a store.
    return degrade(CODES.WHITELIST_FAIL, '这份表里没有合适的店', Math.max(0, limitDaily - used));
  }
  const hitIds = hits.map((row) => row.id);
  const cacheKey = prompt.buildCacheKey(question, hitIds, exclude, config);

  // Cache hit costs nothing and does not consume a daily call.
  const cached = await repo.getCache(db, cacheKey, nowMs, config.CACHE_TTL_DAYS);
  if (cached) {
    return {
      answer: cached, cached: true,
      daily_remaining: Math.max(0, limitDaily - used),
      degraded: false, degrade_reason: '',
    };
  }

  let reservation;
  try {
    reservation = await repo.reserveQuota(db, {
      dailyId, monthKey: keys.monthKey, openid, nowMs,
      limit: limitDaily,
      cap: config.MONTHLY_CAP_MICROS,
      estimateMicros: config.MAX_CALL_MICROS,
      windowSec: config.BUST_WINDOW_SEC,
      burstMax: config.BUST_MAX,
    });
  } catch (err) {
    if (err instanceof AppError &&
        (err.code === CODES.DAILY_LIMIT || err.code === CODES.MONTHLY_CAP)) {
      return degrade(err.code, err.message, 0);
    }
    throw err; // 42901 rate limit stays a normal error envelope
  }

  const excludedNames = exclude
    .map((id) => { const row = seed.find((item) => item.id === id); return row ? row.name : ''; })
    .filter(Boolean);
  // Deep-thinking: full store as compact digest lines (model reasons over all
  // 600 stores, but context stays small enough to answer in a few seconds).
  const messages = prompt.buildMessages(
    question, prompt.buildStoreDigest(hits), excludedNames
  );

  let llmResult;
  try {
    llmResult = await llmFn(config, messages);
  } catch (err) {
    // Paid call failed: refund the reservation and surface one clear error.
    // No automatic retry under any circumstance.
    await settleSafely(db, keys.monthKey, config.MAX_CALL_MICROS, 0, Date.now());
    throw err;
  }
  const actual = costFromUsage(llmResult.usage, config);
  await settleSafely(db, keys.monthKey, config.MAX_CALL_MICROS, actual, Date.now());

  // 50002 on bad output: already charged once, no second call.
  const answer = whitelist.validateAnswer(llmResult.content, hits, seed);

  try {
    await repo.putCache(db, cacheKey, {
      question_norm: question.slice(0, 200),
      hit_restaurant_ids: hitIds,
      excluded_ids: exclude,
      answer,
      data_version: config.DATA_VERSION,
      prompt_version: config.PROMPT_VERSION,
      created_at: nowMs,
    });
  } catch (err) {
    console.warn('cache write failed:', err && err.name ? err.name : 'unknown');
  }

  return {
    answer, cached: false,
    daily_remaining: reservation.dailyRemaining,
    degraded: false, degrade_reason: '',
  };
}

module.exports = { recommend, recall, degrade };
