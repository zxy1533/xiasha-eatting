'use strict';

// Verifies the front-end mock/cloud routing introduced when DeepSeek went live.
// Run: node scripts/test_frontend_routing.js
const assert = require('assert');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'miniprogram', 'services', 'config.js');

function loadWithWx(wxObj) {
  if (wxObj === undefined) delete global.wx;
  else global.wx = wxObj;
  delete require.cache[require.resolve(CONFIG_PATH)];
  return require(CONFIG_PATH);
}

let passed = 0;
function check(name, fn) {
  try { fn(); console.log('PASS  ' + name); passed += 1; }
  catch (e) { console.log('FAIL  ' + name + ' :: ' + e.message); process.exitCode = 1; }
}

check('no wx at all (H5 preview) -> mock', () => {
  assert.strictEqual(loadWithWx(undefined).shouldUseMock(), true);
});
check('wx present but no cloud -> mock', () => {
  assert.strictEqual(loadWithWx({}).shouldUseMock(), true);
});
check('wx.cloud without callFunction -> mock', () => {
  assert.strictEqual(loadWithWx({ cloud: {} }).shouldUseMock(), true);
});
check('wx.cloud.callFunction present (real device) -> cloud (DeepSeek)', () => {
  assert.strictEqual(loadWithWx({ cloud: { callFunction() {} } }).shouldUseMock(), false);
});
check('exports FN names match cloud functions', () => {
  const c = loadWithWx({ cloud: { callFunction() {} } });
  assert.deepStrictEqual(c.FN, { recommend: 'recommend', avoid: 'avoid-lookup', usage: 'usage-check' });
});

console.log('\n' + passed + '/5 routing tests passed');
