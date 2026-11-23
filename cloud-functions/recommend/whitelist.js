'use strict';

const { CODES, AppError } = require('../shared/lib/errors');
const { normalizeName, containsPII, ID_RE } = require('../shared/lib/validate');

const VALID_VERDICTS = new Set(['褒', '贬', '有争议']);

function reject(detail) {
  // 50002 = model output failed validation. No retry, no second charge.
  throw new AppError(CODES.WHITELIST_FAIL, detail);
}

/** Validate a single restaurant object against the hit set + seed. */
function validateOne(raw, hits, seed) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    reject('model returned non-object restaurant');
  }
  const { restaurant_name: name, reason, evidence, verdict } = raw;
  if (typeof name !== 'string' || !name.trim() || name.length > 40) {
    reject('missing restaurant_name');
  }
  if (typeof reason !== 'string' || reason.length < 1 || reason.length > 200) {
    reject('reason length out of range');
  }
  if (!Array.isArray(evidence) || evidence.length < 1 || evidence.length > 2) {
    reject('evidence must be 1-2 quotes');
  }
  if (!evidence.every((item) => typeof item === 'string' && item.length > 0)) {
    reject('evidence element not a string');
  }
  if (!VALID_VERDICTS.has(verdict)) {
    reject('verdict not in enum');
  }
  // If the model echoes an id anyway, it must be one we actually injected.
  if (raw.restaurant_id !== undefined) {
    if (typeof raw.restaurant_id !== 'string' || !ID_RE.test(raw.restaurant_id)) {
      reject('malformed restaurant_id');
    }
    if (!hits.some((row) => row.id === raw.restaurant_id)) {
      reject('restaurant_id outside hit set');
    }
  }
  if (containsPII(reason) || evidence.some((item) => containsPII(item))) {
    reject('PII detected in model answer');
  }

  // Map name -> id from the hit set only. The model never sees ids, so a
  // library-external name cannot slip through by guessing an id.
  const hit = hits.find((row) => normalizeName(row.name) === normalizeName(name));
  if (!hit) {
    reject('restaurant_name outside hit set: ' + name);
  }

  const injectedQuotes = new Set();
  for (const row of hits) {
    // Must match buildStoreDigest's MAX_DIGEST_EVIDENCE (4): the model sees up
    // to 4 quotes per store, so it may quote any of them back.
    for (const quote of row.evidence.slice(0, 4)) injectedQuotes.add(quote);
  }
  for (const quote of evidence) {
    if (!injectedQuotes.has(quote)) reject('evidence not from injected quotes');
  }
  if (verdict !== hit.verdict) {
    reject('verdict disagrees with seed');
  }

  // Scan the free text for any OTHER store in the whole seed. Require >=4
  // chars to avoid flagging incidental 3-character phrases.
  const text = `${reason} ${evidence.join(' ')}`;
  const hitNames = new Set(hits.map((row) => normalizeName(row.name)));
  for (const store of seed) {
    if (store.name.length < 4) continue;
    if (hitNames.has(normalizeName(store.name))) continue;
    if (text.includes(store.name)) {
      reject(`out-of-library store name: ${store.name}`);
    }
  }

  return {
    restaurant_id: hit.id,
    restaurant_name: hit.name,
    reason,
    evidence,
    verdict: hit.verdict,
  };
}

/**
 * Validate untrusted model JSON and derive a whitelisted multi-store answer.
 * Accepts both the single-store shape (legacy) and the new
 * {summary, restaurants:[...]} shape. Each restaurant is validated
 * independently; any invalid store rejects the whole answer (no partial trust).
 */
function validateAnswer(raw, hits, seed) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    reject('model returned non-object');
  }

  // New multi-store shape: { summary, restaurants: [...] }
  if (Array.isArray(raw.restaurants)) {
    if (raw.restaurants.length < 1) {
      reject('restaurants is empty');
    }
    if (raw.restaurants.length > 10) {
      reject('too many restaurants');
    }
    const summary = typeof raw.summary === 'string' ? raw.summary.slice(0, 60) : '';
    if (containsPII(summary)) reject('PII detected in summary');
    const restaurants = raw.restaurants.map((r) => validateOne(r, hits, seed));
    // De-dup by id (the model may list the same store twice).
    const seen = new Set();
    const deduped = restaurants.filter((r) => {
      if (seen.has(r.restaurant_id)) return false;
      seen.add(r.restaurant_id);
      return true;
    });
    return { summary, restaurants: deduped };
  }

  // Legacy single-store shape: { restaurant_name, reason, evidence, verdict }
  const one = validateOne(raw, hits, seed);
  return { summary: '', restaurants: [one] };
}

module.exports = { validateAnswer };
