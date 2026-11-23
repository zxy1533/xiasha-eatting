'use strict';

const dataRepo = require('../shared/lib/data');

const MAX_MATCHES = 5;

/**
 * Local-only verdict lookup. Never calls the LLM (F2).
 * Query matches store name or tags by substring; ranked by mention_count.
 */
function lookup(query) {
  const matches = dataRepo.search(query, MAX_MATCHES);
  return { matches, found: matches.length > 0 };
}

module.exports = { lookup, MAX_MATCHES };
