/**
 * 我的清单（localStorage）+ 页面间传值（answer bus + 换一家 pending + 返回路由）。
 * 不联网、不建账号；读取处做边界校验，和 miniprogram/services/storage.js 同契约。
 */
(function (EatWhat) {
  var KEY = 'xiasha_eat_what_list_v1';
  var MAX_ITEMS = 200;

  function validItem(item) {
    return !!item
      && typeof item.id === 'string' && /^r_[0-9]{4,}$/.test(item.id)
      && typeof item.name === 'string' && item.name.length >= 1 && item.name.length <= 20
      && (item.verdict === '褒' || item.verdict === '贬' || item.verdict === '有争议');
  }

  function readAll() {
    try {
      var raw = window.localStorage.getItem(KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(validItem).slice(0, MAX_ITEMS).map(function (item) {
        return { id: item.id, name: item.name, verdict: item.verdict, addedAt: Number(item.addedAt) || 0 };
      });
    } catch (err) {
      console.warn('storage read failed', err && err.name);
      return [];
    }
  }

  function writeAll(items) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
      return true;
    } catch (err) {
      console.warn('storage write failed', err && err.name);
      return false;
    }
  }

  function add(restaurant) {
    var items = readAll();
    if (!validItem(restaurant)) return { ok: false, reason: 'invalid', items: items };
    if (items.some(function (it) { return it.id === restaurant.id; })) {
      return { ok: false, reason: 'exists', items: items };
    }
    var next = [{ id: restaurant.id, name: restaurant.name, verdict: restaurant.verdict, addedAt: Date.now() }].concat(items);
    return { ok: writeAll(next), reason: 'added', items: readAll() };
  }

  function remove(id) {
    var items = readAll();
    var index = -1;
    for (var i = 0; i < items.length; i += 1) { if (items[i].id === id) { index = i; break; } }
    if (index < 0) return { ok: false, removed: null, index: -1, items: items };
    var removed = items[index];
    items.splice(index, 1);
    var ok = writeAll(items);
    return { ok: ok, removed: ok ? removed : null, index: index, items: readAll() };
  }

  function restore(item, index) {
    if (!validItem(item)) return { ok: false, items: readAll() };
    var items = readAll();
    if (items.some(function (it) { return it.id === item.id; })) return { ok: true, items: items };
    var at = Math.max(0, Math.min(index, items.length));
    items.splice(at, 0, item);
    return { ok: writeAll(items), items: readAll() };
  }

  function has(id) {
    return readAll().some(function (it) { return it.id === id; });
  }

  // —— 页面间传值 ——
  var lastAnswer = null;
  var returnRoute = 'index';
  var pendingChangeOne = false;

  EatWhat.store = {
    readAll: readAll,
    add: add,
    remove: remove,
    restore: restore,
    has: has,
    setAnswer: function (a) { lastAnswer = a || null; },
    getAnswer: function () { return lastAnswer; },
    setReturnRoute: function (r) { returnRoute = r || 'index'; },
    getReturnRoute: function () { return returnRoute; },
    setPendingChangeOne: function () { pendingChangeOne = true; },
    consumeChangeOne: function () { var p = pendingChangeOne; pendingChangeOne = false; return p; },
  };
})(window.EatWhat = window.EatWhat || {});
