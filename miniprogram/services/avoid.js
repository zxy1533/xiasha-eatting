/** 避雷查询：与云函数 avoid-lookup 同契约，读种子数据，不调大模型。 */
const { shouldUseMock, FN } = require('./config.js');
const { call } = require('./cloud-call.js');
const { envelope } = require('./errors.js');
const { RESTAURANTS } = require('../mock/restaurants.js');
const { matchRestaurant } = require('../utils/normalize.js');
const { safeEvidence } = require('../utils/safe-render.js');

function toMatch(raw) {
  return {
    id: String(raw.id || ''),
    name: String(raw.name || ''),
    verdict: raw.verdict === '褒' || raw.verdict === '贬' || raw.verdict === '有争议' ? raw.verdict : '有争议',
    evidence: safeEvidence(raw.evidence).slice(0, 2),
    tags: Array.isArray(raw.tags) ? raw.tags.slice(0, 6) : [],
    source_sheet: String(raw.source_sheet || ''),
    mention_count: Number(raw.mention_count) || 1,
  };
}

function lookup(query) {
  const q = typeof query === 'string' ? query.trim() : '';
  if (!q || q.length > 40) {
    return Promise.resolve(envelope(40001, null, '换个写法试试'));
  }

  if (shouldUseMock()) {
    const matches = RESTAURANTS
      .filter(function (r) { return matchRestaurant(r, q); })
      .sort(function (a, b) { return b.mention_count - a.mention_count; })
      .slice(0, 5)
      .map(toMatch);
    return Promise.resolve(envelope(0, { matches: matches, found: matches.length > 0 }));
  }

  return call(FN.avoid, { query: q }).then(function (env) {
    if (env.code !== 0 || !env.data) return env;
    const raw = Array.isArray(env.data.matches) ? env.data.matches : [];
    return envelope(0, {
      matches: raw.slice(0, 5).map(toMatch),
      found: env.data.found === true,
    });
  });
}

module.exports = { lookup };
