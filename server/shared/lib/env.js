'use strict';

const fs = require('fs');
const path = require('path');

// Zero-dependency .env loader. Real deployments inject env vars at the
// platform level (WeChat cloud console); this only fills in gaps for local
// verification, and only for keys that are not already set. Never logs values.
function loadLocalEnv(startDir) {
  let dir = startDir;
  // Walk up a few levels to find the nearest .env that belongs to this fn.
  for (let i = 0; i < 4; i += 1) {
    const file = path.join(dir, '.env');
    try {
      if (fs.existsSync(file)) {
        const text = fs.readFileSync(file, 'utf8');
        for (const line of text.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eq = trimmed.indexOf('=');
          if (eq <= 0) continue;
          const key = trimmed.slice(0, eq).trim();
          const val = trimmed.slice(eq + 1).trim();
          if (key && process.env[key] === undefined) process.env[key] = val;
        }
        return file;
      }
    } catch (err) {
      // Local env is best-effort; a real env var always wins.
      return null;
    }
    dir = path.dirname(dir);
  }
  return null;
}

module.exports = { loadLocalEnv };
