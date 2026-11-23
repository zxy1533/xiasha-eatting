'use strict';

const fs = require('fs');
const path = require('path');

const SEED_PATH = path.join(__dirname, '..', 'data', 'restaurants.json');

// Cold start reads the seed once; subsequent calls reuse the in-memory array.
let cachedSeed = null;

function loadSeed() {
  if (cachedSeed) return cachedSeed;
  const raw = fs.readFileSync(SEED_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('restaurants seed is empty or not an array');
  }
  cachedSeed = Object.freeze(parsed.map((row) => Object.freeze(row)));
  return cachedSeed;
}

/** Only for tests: drop the memoized copy so a rewritten seed can be re-read. */
function resetSeedCache() {
  cachedSeed = null;
}

function getById(id) {
  return loadSeed().find((row) => row.id === id) || null;
}

function byName(name) {
  const needle = String(name || '');
  return loadSeed().filter((row) => row.name === needle);
}

/** Substring match on name and tags, ranked by mention_count desc (F2/F5). */
function search(query, maxResults) {
  const needle = String(query || '').toLowerCase();
  const limit = maxResults || 5;
  return loadSeed()
    .filter(
      (row) =>
        row.name.toLowerCase().includes(needle) ||
        row.tags.some((tag) => tag.toLowerCase().includes(needle))
    )
    .sort((a, b) => b.mention_count - a.mention_count)
    .slice(0, limit);
}

module.exports = { loadSeed, resetSeedCache, getById, byName, search, SEED_PATH };
