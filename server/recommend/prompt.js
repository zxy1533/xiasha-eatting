'use strict';

const crypto = require('crypto');
const { normalizeQuestion, normalizeName } = require('../shared/lib/validate');

// AC-04 / F7-d: exactly five fields may cross the trust boundary into the
// model. Adding a field requires an explicit edit here (allow-list, not
// deny-list), so a future source_sheet/openid addition cannot leak by accident.
const WHITELIST_FIELDS = Object.freeze([
  'name', 'verdict', 'evidence', 'tags', 'mention_count',
]);
const MAX_EVIDENCE_PER_STORE = 2;

function projectRestaurants(rows) {
  return rows.map((row) => {
    const projected = {};
    for (const field of WHITELIST_FIELDS) {
      if (field === 'evidence') {
        projected.evidence = row.evidence.slice(0, MAX_EVIDENCE_PER_STORE);
      } else {
        projected[field] = row[field];
      }
    }
    return projected;
  });
}

// Compact one-line summary per store for deep-thinking mode. The model gets
// the FULL 600 stores but as terse lines ("店名｜判定｜标签｜一句完整原话") so
// the context stays much smaller than full JSON while preserving the model's
// freedom to reason over every store. The quote is kept WHOLE (not truncated)
// so whitelist.js can exact-match it back to the seed. Not a ranking — no
// score is computed.
const VERDICT_CN = { 褒: '推荐', 贬: '避雷', 有争议: '有争议' };
// Give the model the FULL evidence (up to 4 quotes) per store so it can infer
// taste profiles (辣/甜/清淡/酸/油腻/重口) from the raw student reviews by
// itself — this is the "let the AI do the work" path: we don't precompute taste
// labels, we hand the raw material to the model and let it reason.
const MAX_DIGEST_EVIDENCE = 4;
function buildStoreDigest(rows) {
  const lines = rows.map((row) => {
    const tags = (row.tags && row.tags.length) ? row.tags.join('/') : '无标签';
    const v = VERDICT_CN[row.verdict] || row.verdict;
    const quotes = (row.evidence || [])
      .slice(0, MAX_DIGEST_EVIDENCE)
      .map((q) => q.replace(/\s+/g, ' '))
      .join('；');
    const mention = row.mention_count ? `,${row.mention_count}人提` : '';
    return `${row.name}｜${v}${mention}｜${tags}${quotes ? '｜' + quotes : ''}`;
  });
  return lines.join('\n');
}

// Implementation note: the seed id is deliberately NOT injected (only the 5
// whitelisted fields are). The model returns a restaurant_name; whitelist.js
// maps that name back to an id from the hit set. This keeps AC-04 at 5 fields
// while the outward answer still satisfies the r_\d{4,} id contract.
// Knowledge-base background: the shape of the whole dataset. The model now
// receives the FULL store (600 rows) in the user message and must reason about
// which rows match the user's intent. This static prefix tells it the rubric.
const KB_BACKGROUND = [
  '数据背景：这是下沙高校圈学生接力填写的吃饭共享表，共 600 家店（推荐/避雷/有争议三类），已在用户消息里全部给你。',
  '标签体系：辣、便宜、堂食、外卖、盖饭、拌粉面、面食、份量足、份量少、炸物、甜品、饮品、早餐、夜宵、争议。',
  '「推荐」=多数学生说好吃；「避雷」=多数踩雷（难吃、贵、量少、卫生或拉肚子）；「有争议」=褒贬都有，同一家有人夸有人骂。',
  '用户说话是口语（如"填饱""别太油""辣一点"），你要自己把这些理解成标签意图，再在全量数据里找匹配的店。',
].join('\n');

const SYSTEM_PROMPT = [
  KB_BACKGROUND,
  '你是下沙高校圈吃饭助手，负责从全量数据里按用户要求把店找出来。',
  '数据格式：每行一家店，形如「店名｜判定｜提及数｜标签｜多条原话」。判定分推荐/避雷/有争议；原话是学生写的真实评价。',
  '先在脑子里深度思考这几步，再输出答案：',
  '  1) 判定用户说的是「具体菜品」还是「品类」还是「口味」。例："蛋炒饭"是**具体菜品**；"炒饭""炒粉"是**品类**；"吃辣""想吃甜的"是**口味**。这三类匹配方式完全不同，别混。',
  '  2) 提炼口味：从每家店的**多条原话**里，自己判断这家店的真实口味画像。比如原话里反复出现"辣""麻辣"，就是辣味店；出现"甜""齁甜""不辣"就是偏甜或清淡；出现"油""腻"就是重油。不要只看标签，要从原话里读出来。',
  '  3) 检索匹配（铁律）：你返回的每一家店，**主业**必须符合用户要的东西，且能在它自己的原话或菜名里看到依据。',
  '     - 判主业看**店名 + 标签**，不要只看原话里顺嘴提到的一个菜名。例：一家「面馆」的原话里哪怕有人夸了句"炒饭好吃"，它的主业仍是面，不能当炒饭店推荐。',
  '     - 用户说具体菜品（如"蛋炒饭"）：只返回「店名或标签就指向炒饭/主食」且原话里也提到炒饭的店，不能选面馆、火锅店、烧鸭饭这种主业不搭的店。',
  '     - 用户说口味（如"吃辣"）：只返回原话里能读出"辣"的店，不要靠标签硬套。',
  '     - **严禁**用不相干的店凑数：用户要"蛋炒饭"，绝不返回"铁锅炖""火锅""炖锅""面馆"这种主业都不同的店，哪怕原话里碰巧有个"饭"字。',
  '  4) 找不到就直说：如果全量数据里根本没有主业匹配的店（比如没人提过蛋炒饭、也没有专门炒饭店），summary 里如实说"表里没有直接卖蛋炒饭的店，最接近的是 XX"，只返回最接近的主食/炒饭店，宁可少给也不要硬塞主业不搭的店。',
  '  5) 呈现：按用户要的数量返回（问两家给两家，说"来几家"给 3 家左右），凑不够就如实说有几家，不要用弱相关的店填数。',
  '所有事实（店名、评价、标签）必须来自用户消息给的数据；禁止编造库外店名。',
  '输出严格 JSON：{"summary":"...","restaurants":[{"restaurant_name":"...","reason":"...","evidence":["..."],"verdict":"褒|贬|有争议"}, ...]}。',
  'summary：一句话总结（比如"下沙表里一共 6 家螺蛳粉店，给你挑了两家口碑最稳的"），20 字以内，语气像同学说话。',
  '每家 reason：说清这家为什么符合用户要的口味、口碑如何，必须引用该店原话；长度 1-120 字，语气像同学说话。',
  '每家 evidence：原样复制该店的原话，最多 2 条。',
  '用户"排除"列表里的店不许再出现。',
  '有争议的店在 reason 里如实说"表里有争议，有人觉得好吃有人踩雷"，让用户自己掂量。',
  '不要输出 Markdown、代码块标记或任何解释性前后缀，只输出 JSON（思考过程留在内部 reasoning，不写进 JSON）。',
].join('\n');

function buildMessages(question, projected, excludedNames) {
  const excluded = excludedNames && excludedNames.length
    ? `\n明确排除、不许再推荐的店：${excludedNames.join('、')}`
    : '';
  // projected is the digest lines (see buildStoreDigest). Each line:
  // 店名｜判定｜标签｜一句原话
  const user = [
    `用户问题：${question}`,
    `全量餐馆数据（每行一家，共 ${projected.length} 家）：`,
    projected,
    excluded,
    '请先思考用户意图（包括要几家），再从全量数据里检索出匹配的店，按用户要的数量返回，输出 JSON。',
  ].filter(Boolean).join('\n');
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: user },
  ];
}

/**
 * F7-c cache key: SHA256(normalized question | sorted hit ids | sorted
 * excludes | data_version | prompt_version). Including hits/excludes/version
 * is what prevents answer cross-contamination between different questions.
 */
function buildCacheKey(question, hitIds, exclude, config) {
  const parts = [
    normalizeQuestion(question),
    [...hitIds].sort().join(','),
    [...(exclude || [])].sort().join(','),
    String(config.DATA_VERSION),
    config.PROMPT_VERSION,
  ];
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
}

module.exports = {
  WHITELIST_FIELDS,
  SYSTEM_PROMPT,
  projectRestaurants,
  buildStoreDigest,
  buildMessages,
  buildCacheKey,
  normalizeName,
};
