'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const { resolveConfig } = require('./shared/lib/config');
const { CODES, AppError, ok, fail, normalizeError } = require('./shared/lib/errors');
const { checkQuestion, checkExclude, checkQuery } = require('./shared/lib/validate');
const recommendService = require('./recommend/service');
const avoidService = require('./avoid/service');
const usageService = require('./usage/service');
const { callLLM } = require('./recommend/llm');
const repo = require('./recommend/repo');

// F7-e: the key lives only in the environment; absence fails at cold start.
// resolveConfig reads process.env (populated by shared/lib/config via the
// zero-dependency .env loader for local dev, or the platform env vars).
const config = resolveConfig(process.env);
const store = repo.createStore();

const PORT = Number(process.env.PORT) || 8080;
const HOST = '0.0.0.0';
const MAX_BODY_BYTES = 1024 * 1024; // 1MB guard on request bodies

// Phase 1: the H5 frontend is not deployed yet, so CORS is permissive. Before
// launch, set CORS_ORIGIN to the real frontend origin (never '*' in prod).
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': CORS_ORIGIN,
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-device-id',
  'Access-Control-Max-Age': '86400',
};

if (CORS_ORIGIN === '*') {
  console.warn('CORS_ORIGIN is "*" — set it to the real frontend origin before launch');
}

/**
 * Anti-abuse key: the frontend sends an anonymous device_id (localStorage) in
 * the x-device-id header. Fallback to the socket address so a plain curl still
 * works and gets a stable-ish key for the burst guard.
 */
function deviceIdOf(req) {
  const h = req.headers['x-device-id'];
  if (typeof h === 'string' && h.trim()) return h.trim().slice(0, 64);
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let size = 0;
    const chunks = [];
    const done = (fn, arg) => { if (!settled) { settled = true; fn(arg); } };

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        done(reject, new AppError(CODES.BAD_INPUT, 'request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return done(resolve, {});
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        done(resolve, JSON.parse(raw));
      } catch (err) {
        done(reject, new AppError(CODES.BAD_INPUT, 'invalid JSON body'));
      }
    });
    req.on('error', () => done(reject, new AppError(CODES.BAD_INPUT, 'body read error')));
  });
}

function sendJson(res, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(200, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  }, CORS_HEADERS));
  res.end(body);
}

async function handleRecommend(req) {
  const input = await readJsonBody(req);
  const question = checkQuestion(input.question);
  const exclude = checkExclude(input.exclude);
  const result = await recommendService.recommend(
    { question, exclude },
    { config, store, nowMs: Date.now(), deviceId: deviceIdOf(req), llmFn: callLLM }
  );
  if (result && result.__degraded) {
    return { code: result.code, data: result.data, message: result.data.degrade_reason };
  }
  return ok(result);
}

async function handleAvoid(req) {
  const input = await readJsonBody(req);
  const query = checkQuery(input.query);
  return ok(avoidService.lookup(query));
}

async function handleUsage() {
  return ok(await usageService.checkUsage({ config, store, nowMs: Date.now() }));
}

// ── Static H5 hosting ────────────────────────────────────────────────────────
// The same single port serves both the API and the web/ static frontend, so the
// browser can call /api/* same-origin (no CORS needed in production).
const WEB_ROOT = path.resolve(__dirname, 'web');
const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8',
});

function sendStatic(res, absPath, shareQuery) {
  const ext = path.extname(absPath).toLowerCase();
  const contentType = MIME[ext];
  if (!contentType) return false; // unsupported extension -> let caller 404
  let stat;
  try {
    stat = fs.statSync(absPath);
  } catch (err) {
    return false;
  }
  if (!stat.isFile()) return false;
  let body = fs.readFileSync(absPath);
  // The publish gateway requires `sharecode` on EVERY request, including
  // static assets. index.html references css/js by relative path, so rewrite
  // them to carry the sharecode when the page itself was loaded with one.
  if (ext === '.html' && shareQuery) {
    let html = body.toString('utf8');
    html = html
      .replace(/(href=")(css\/|js\/)([^"]+)(")/g, '$1/$2$3' + shareQuery + '$4')
      .replace(/(src=")(css\/|js\/)([^"]+)(")/g, '$1/$2$3' + shareQuery + '$4');
    body = Buffer.from(html, 'utf8');
  }
  res.writeHead(200, Object.assign({
    'Content-Type': contentType,
    'Content-Length': body.length,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
  }, CORS_HEADERS));
  res.end(body);
  return true;
}

/**
 * Serve web/ statically with path-traversal guard.
 * Only known extensions under WEB_ROOT are served; anything else returns false.
 * `rawUrl` includes the query string so the sharecode can be propagated into
 * the HTML's asset references.
 */
function serveStatic(res, urlPath, rawUrl) {
  const rel = decodeURIComponent(urlPath === '/' ? '/index.html' : urlPath);
  const abs = path.resolve(WEB_ROOT, '.' + rel);
  // Guard: resolved path must stay inside WEB_ROOT.
  if (abs !== WEB_ROOT && !abs.startsWith(WEB_ROOT + path.sep)) {
    return false;
  }
  let shareQuery = '';
  const m = /[?&]sharecode=([^&]+)/.exec(rawUrl || '');
  if (m) shareQuery = '?sharecode=' + encodeURIComponent(m[1]);
  return sendStatic(res, abs, shareQuery);
}

const server = http.createServer((req, res) => {
  const method = req.method || 'GET';
  const url = (req.url || '/').split('?')[0];

  // Dispatch synchronously; async handlers resolve to an envelope object.
  Promise.resolve()
    .then(() => {
      if (method === 'OPTIONS') {
        res.writeHead(204, CORS_HEADERS);
        res.end();
        return null;
      }
      if (method === 'POST' && url === '/api/recommend') return handleRecommend(req);
      if (method === 'POST' && url === '/api/avoid') return handleAvoid(req);
      if (method === 'GET' && url === '/api/usage') return handleUsage();
      // Everything else on GET is a static asset from web/.
      if (method === 'GET') {
        if (serveStatic(res, url, req.url)) return null; // already responded
        return fail(CODES.NOT_FOUND, '页面不存在');
      }
      return fail(CODES.NOT_FOUND, '接口不存在');
    })
    .then((envelope) => {
      if (envelope !== null) sendJson(res, envelope);
    })
    .catch((err) => {
      if (err instanceof AppError) {
        sendJson(res, fail(err.code, err.message));
      } else {
        console.warn('request failed:', err && err.detail ? err.detail : err && err.name);
        sendJson(res, normalizeError(err));
      }
    });
});

server.listen(PORT, HOST, () => {
  console.log(`eat-what web backend listening on http://${HOST}:${PORT}`);
});

// Graceful shutdown: clear pending handles so the process can exit cleanly.
function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
