/** 我的清单：只写本机 storage，不联网、不建账号。读取处做一次边界校验。 */
const { STORAGE_KEY } = require('./config.js');

const MAX_ITEMS = 200;

function validItem(item) {
  return !!item
    && typeof item.id === 'string' && /^r_[0-9]{4,}$/.test(item.id)
    && typeof item.name === 'string' && item.name.length >= 1 && item.name.length <= 20
    && (item.verdict === '褒' || item.verdict === '贬' || item.verdict === '有争议');
}

function readAll() {
  try {
    const raw = wx.getStorageSync(STORAGE_KEY);
    if (!Array.isArray(raw)) return [];
    return raw.filter(validItem).slice(0, MAX_ITEMS).map(function (item) {
      return { id: item.id, name: item.name, verdict: item.verdict, addedAt: Number(item.addedAt) || 0 };
    });
  } catch (err) {
    console.warn('storage read failed', err && err.name);
    return [];
  }
}

function writeAll(items) {
  try {
    wx.setStorageSync(STORAGE_KEY, items.slice(0, MAX_ITEMS));
    return true;
  } catch (err) {
    console.warn('storage write failed', err && err.name);
    return false;
  }
}

function add(restaurant) {
  const items = readAll();
  if (!validItem(restaurant)) return { ok: false, reason: 'invalid', items: items };
  if (items.some(function (it) { return it.id === restaurant.id; })) {
    return { ok: false, reason: 'exists', items: items };
  }
  const next = [{ id: restaurant.id, name: restaurant.name, verdict: restaurant.verdict, addedAt: Date.now() }].concat(items);
  return { ok: writeAll(next), reason: 'added', items: readAll() };
}

function remove(id) {
  const items = readAll();
  const index = items.findIndex(function (it) { return it.id === id; });
  if (index < 0) return { ok: false, removed: null, index: -1, items: items };
  const removed = items[index];
  items.splice(index, 1);
  const ok = writeAll(items);
  return { ok: ok, removed: ok ? removed : null, index: index, items: readAll() };
}

function restore(item, index) {
  if (!validItem(item)) return { ok: false, items: readAll() };
  const items = readAll();
  if (items.some(function (it) { return it.id === item.id; })) return { ok: true, items: items };
  const at = Math.max(0, Math.min(index, items.length));
  items.splice(at, 0, item);
  return { ok: writeAll(items), items: readAll() };
}

function has(id) {
  return readAll().some(function (it) { return it.id === id; });
}

module.exports = { readAll, add, remove, restore, has };
