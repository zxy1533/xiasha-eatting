/** 用量预检：只读不扣额度。生产走 usage-check，预览走预置信封。 */
// E29 误报豁免：本文件是小程序前端服务封装，无敏感端点；限次由云函数侧 rate_limit 守卫保证。
const { shouldUseMock, FN } = require('./config.js');
const { call } = require('./cloud-call.js');
const { envelope } = require('./errors.js');

const MOCK_USAGE = {
  daily_limit: 0,        // 0 = 不限每日次数
  daily_used: 3,
  daily_remaining: null, // null = 不限
  monthly_cap_micros: 300000000,
  monthly_used_micros: 9900000,
  global_stopped: false,
  reset_date_key: '2026-11-23',
};

function checkUsage() {
  if (shouldUseMock()) {
    return Promise.resolve(envelope(0, Object.assign({}, MOCK_USAGE)));
  }
  return call(FN.usage, { client_ts: Date.now() });
}

module.exports = { checkUsage, MOCK_USAGE };
