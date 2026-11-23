/**
 * 调用层：fetch 调后端三个 /api 接口，保留信封 {code, data, message} 归一。
 * device_id 用 localStorage 生成匿名号，放 x-device-id 头 + body 里（后端只认头）。
 * API_BASE 默认同源（server.js 同时 serve 静态页与 /api）；本地联调可用 ?api=http://localhost:8080 覆盖。
 */
(function (EatWhat) {
  var API_BASE = (function () {
    var m = /[?&]api=([^&]+)/.exec(window.location.search);
    if (m) return decodeURIComponent(m[1]).replace(/\/+$/, '');
    return '';
  })();

  // The publish gateway requires `sharecode` on every request (page AND /api).
  // Carry it from the current page URL onto every API call so the SPA works
  // behind the WorkBuddy share link. Local dev has no sharecode -> no-op.
  var SHARE_QUERY = (function () {
    var m = /[?&]sharecode=([^&]+)/.exec(window.location.search);
    return m ? 'sharecode=' + encodeURIComponent(m[1]) : '';
  })();

  function withShare(path) {
    if (!SHARE_QUERY) return path;
    return path + (path.indexOf('?') >= 0 ? '&' : '?') + SHARE_QUERY;
  }

  var CALL_TIMEOUT_MS = 30000; // DeepSeek 深度思考 9~18s，放宽到 30s

  function deviceId() {
    var KEY = 'eatwhat_device_id_v1';
    try {
      var id = window.localStorage.getItem(KEY);
      if (!id) {
        id = 'd_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
        window.localStorage.setItem(KEY, id);
      }
      return id;
    } catch (err) {
      return 'd_anon';
    }
  }

  function request(path, options) {
    var opts = options || {};
    var method = opts.method || 'GET';
    var headers = Object.assign({
      'Content-Type': 'application/json',
      'x-device-id': deviceId(),
    }, opts.headers || {});
    var body = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;

    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, CALL_TIMEOUT_MS) : null;
    function done() { if (timer) { clearTimeout(timer); timer = null; } }

    return fetch(API_BASE + withShare(path), {
      method: method,
      headers: headers,
      body: body,
      signal: ctrl ? ctrl.signal : undefined,
    }).then(function (res) {
      done();
      return res.json().catch(function () {
        return { code: 50003, data: null, message: '服务暂不可用' };
      });
    }).catch(function (err) {
      done();
      if (err && err.name === 'AbortError') {
        return { code: 50001, data: null, message: '今天有点忙，等下再问一次' };
      }
      return { code: 'offline', data: null, message: '没网了，连上再说' };
    });
  }

  function normalizeRestaurant(raw) {
    if (!raw || !raw.restaurant_id || !raw.restaurant_name) return null;
    return {
      restaurant_id: String(raw.restaurant_id),
      restaurant_name: String(raw.restaurant_name),
      reason: String(raw.reason || ''),
      evidence: (Array.isArray(raw.evidence) ? raw.evidence : []).map(String).filter(function (s) { return s.length > 0; }).slice(0, 10),
      verdict: (raw.verdict === '褒' || raw.verdict === '贬' || raw.verdict === '有争议') ? raw.verdict : '有争议',
    };
  }

  function normalizeAnswer(raw) {
    if (!raw) return null;
    if (Array.isArray(raw.restaurants)) {
      var list = raw.restaurants.map(normalizeRestaurant).filter(function (r) { return r !== null && r.evidence.length > 0; });
      if (list.length === 0) return null;
      return { summary: String(raw.summary || ''), restaurants: list };
    }
    var single = normalizeRestaurant(raw);
    if (!single) return null;
    return { summary: '', restaurants: [single] };
  }

  function normalizeMatch(raw) {
    return {
      id: String(raw.id || ''),
      name: String(raw.name || ''),
      verdict: (raw.verdict === '褒' || raw.verdict === '贬' || raw.verdict === '有争议') ? raw.verdict : '有争议',
      evidence: (Array.isArray(raw.evidence) ? raw.evidence : []).map(String).filter(function (s) { return s.length > 0; }).slice(0, 2),
      tags: Array.isArray(raw.tags) ? raw.tags.slice(0, 6) : [],
      source_sheet: String(raw.source_sheet || ''),
      mention_count: Number(raw.mention_count) || 1,
    };
  }

  EatWhat.api = {
    recommend: function (question, exclude) {
      return request('/api/recommend', {
        method: 'POST',
        body: { question: question, exclude: exclude, device_id: deviceId() },
      }).then(function (env) {
        if (!env || env.code !== 0 || !env.data || !env.data.answer) return env;
        var answer = normalizeAnswer(env.data.answer);
        if (!answer) return { code: 50002, data: null, message: '这次没挑出来，换个说法试试' };
        env.data.answer = answer;
        return env;
      });
    },
    avoid: function (query) {
      return request('/api/avoid', { method: 'POST', body: { query: query } }).then(function (env) {
        if (!env || env.code !== 0 || !env.data) return env;
        var raw = Array.isArray(env.data.matches) ? env.data.matches : [];
        env.data.matches = raw.slice(0, 5).map(normalizeMatch);
        env.data.found = env.data.found === true;
        return env;
      });
    },
    usage: function () {
      return request('/api/usage', { method: 'GET' });
    },
  };

  EatWhat.normalizeAnswer = normalizeAnswer;
  EatWhat.deviceId = deviceId;
})(window.EatWhat = window.EatWhat || {});
