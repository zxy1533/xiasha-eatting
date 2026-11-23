/**
 * 前端服务配置。
 *
 * 问答已经接入 DeepSeek（通过 recommend 云函数）。默认 AUTO：
 * - 真机/体验版/正式版（wx.cloud 可用）→ 调用云函数，由 DeepSeek 拍板；
 * - WorkBuddy H5 预览（无 wx.cloud）→ 自动降级到本地预置数据，只为了把界面渲染出来。
 *
 * 想强制只用云函数（例如真机联调），改成 false；强制预览数据改成 true。
 * 注意：mock 不是本地打分器，没有任何"按口味算分选店"的逻辑。
 */
const USE_MOCK = 'auto';

const FN = {
  recommend: 'recommend',
  avoid: 'avoid-lookup',
  usage: 'usage-check',
};

// 深度思考模式下，云函数要等 DeepSeek 推理完（实测 9~18s），前端等待放宽到 30s。
const CALL_TIMEOUT_MS = 30000;

const STORAGE_KEY = 'xiasha_eat_what_list_v1';

/**
 * Resolve mock vs cloud at call time.
 * true  -> always local preview data
 * false -> always cloud function
 * 'auto'-> cloud when wx.cloud is usable (real device /体验版 /正式版),
 *          local preview data otherwise (WorkBuddy H5 preview has no wx.cloud).
 */
function shouldUseMock() {
  if (USE_MOCK === true) return true;
  if (USE_MOCK === false) return false;
  // auto: cloud available means real WeChat runtime with cloud dev enabled.
  var wxObj = typeof wx !== 'undefined' ? wx : null;
  var hasCloud = !!(wxObj && wxObj.cloud && typeof wxObj.cloud.callFunction === 'function');
  return !hasCloud;
}

module.exports = { USE_MOCK, shouldUseMock, FN, CALL_TIMEOUT_MS, STORAGE_KEY };
