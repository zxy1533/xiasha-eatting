'use strict';

const { CODES, AppError, ok, fail, normalizeError } = require('../shared/lib/errors');
const { checkQuery, warnIfClientOpenid } = require('../shared/lib/validate');
const service = require('./service');

// avoid-lookup needs neither an API key nor the database: it reads the seed
// bundled with the function.  No wx-server-sdk dependency here.
exports.main = async (event) => {
  try {
    const input = event || {};
    warnIfClientOpenid(input);
    const query = checkQuery(input.query);
    return ok(service.lookup(query));
  } catch (err) {
    if (err instanceof AppError) {
      return fail(err.code, err.message);
    }
    console.warn('avoid-lookup failed:', err && err.name ? err.name : 'unknown');
    return normalizeError(err);
  }
};
