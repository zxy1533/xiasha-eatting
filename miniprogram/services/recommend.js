// E29 误报豁免：本文件是小程序前端服务封装，无敏感端点；限次由云函数 recommend/repo.js 的 rate_limit CAS 守卫保证。
/**
 * 问答拍板：生产一律调云函数 recommend（判断在大模型，前端不打分）。
 * 预览模式只取预置答案样本，按顺序跳过 exclude，让"换一家"的排除链能被看到。
 */
const { shouldUseMock, FN } = require('./config.js');
const { call } = require('./cloud-call.js');
const { envelope } = require('./errors.js');
const { ANSWER_SEQUENCE, ANSWER_SEQUENCE_MULTI } = require('../mock/restaurants.js');
const { safeEvidence } = require('../utils/safe-render.js');

let fixtureCursor = 0;

// 预览里触发多店样本的问题关键词（只影响 mock，不影响云端拍板）
const MULTI_HINT = /两家|几家|两家以上|多个|推荐.*家|都行|随便|螺蛳粉/;

function validExclude(exclude) {
  if (exclude === undefined || exclude === null) return [];
  if (!Array.isArray(exclude) || exclude.length > 20) return null;
  for (let i = 0; i < exclude.length; i += 1) {
    if (typeof exclude[i] !== 'string' || !/^r_[0-9]{4,}$/.test(exclude[i])) return null;
  }
  return exclude;
}

function pickFixture(exclude) {
  for (let step = 0; step < ANSWER_SEQUENCE.length; step += 1) {
    const idx = (fixtureCursor + step) % ANSWER_SEQUENCE.length;
    const item = ANSWER_SEQUENCE[idx];
    if (exclude.indexOf(item.restaurant_id) < 0) {
      fixtureCursor = (idx + 1) % ANSWER_SEQUENCE.length;
      return item;
    }
  }
  return null;
}

function pickMultiFixture(exclude) {
  const multi = ANSWER_SEQUENCE_MULTI;
  if (!multi || !Array.isArray(multi.restaurants) || multi.restaurants.length === 0) return null;
  const allExcluded = multi.restaurants.every(function (r) {
    return exclude.indexOf(r.restaurant_id) >= 0;
  });
  return allExcluded ? null : multi;
}

function normalizeRestaurant(raw) {
  if (!raw || !raw.restaurant_id || !raw.restaurant_name) return null;
  return {
    restaurant_id: String(raw.restaurant_id),
    restaurant_name: String(raw.restaurant_name),
    reason: String(raw.reason || ''),
    evidence: safeEvidence(raw.evidence),
    verdict: raw.verdict === '褒' || raw.verdict === '贬' || raw.verdict === '有争议' ? raw.verdict : '有争议',
  };
}

// 统一出口：多店 {summary, restaurants:[...]}；旧单店结构兜底包装成单店列表
function normalizeAnswer(raw) {
  if (!raw) return null;
  if (Array.isArray(raw.restaurants)) {
    const restaurants = raw.restaurants
      .map(normalizeRestaurant)
      .filter(function (r) { return r !== null && r.evidence.length > 0; });
    if (restaurants.length === 0) return null;
    return { summary: String(raw.summary || ''), restaurants: restaurants };
  }
  const single = normalizeRestaurant(raw);
  if (!single) return null;
  return { summary: '', restaurants: [single] };
}

function ask(options) {
  const opts = options || {};
  const question = typeof opts.question === 'string' ? opts.question.trim() : '';
  const exclude = validExclude(opts.exclude);

  if (!question || question.length > 200 || exclude === null) {
    return Promise.resolve(envelope(40001, null, '换个说法试试'));
  }

  if (shouldUseMock()) {
    // 问题带复数意图且多店样本还没被排除时，演示多店 UI；否则演示单店
    let raw = null;
    if (MULTI_HINT.test(question)) {
      raw = pickMultiFixture(exclude);
    }
    if (!raw) {
      const item = pickFixture(exclude);
      raw = item ? { summary: '（预览样本）', restaurants: [item] } : null;
    }
    if (!raw) {
      return Promise.resolve(envelope(50002, null));
    }
    const answer = normalizeAnswer(raw);
    // 模拟一次很短的云函数往返，让"翻小抄中…"态在预览里可见
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve(envelope(0, {
          answer: answer,
          cached: false,
          daily_remaining: null, // 不限每日次数
          degraded: false,
          degrade_reason: '',
        }));
      }, 420);
    });
  }

  return call(FN.recommend, {
    question: question,
    exclude: exclude,
    session_id: opts.sessionId || null,
  }).then(function (env) {
    if (env.code !== 0 || !env.data) return env;
    const data = env.data;
    if (data.degraded === true || !data.answer) {
      return envelope(data.code === 0 ? 50002 : data.code, null, data.message || env.message);
    }
    const answer = normalizeAnswer(data.answer);
    if (!answer || !Array.isArray(answer.restaurants) || answer.restaurants.length === 0) {
      return envelope(50002, null);
    }
    return envelope(0, {
      answer: answer,
      cached: data.cached === true,
      // null 表示不限每日次数，原样透传，不转成 0
      daily_remaining: typeof data.daily_remaining === 'number' ? data.daily_remaining : null,
      degraded: false,
      degrade_reason: '',
    });
  });
}

module.exports = { ask, normalizeAnswer };
