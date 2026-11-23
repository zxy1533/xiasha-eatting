/** 云函数调用统一封装：离线检查 + 12s 客户端超时 + 信封归一（E11 外部调用必须有超时） */
// E29 误报豁免：本文件是小程序前端服务封装，无登录/短信/支付端点；限次由云函数侧 rate_limit 守卫保证。
const { CALL_TIMEOUT_MS } = require('./config.js');
const { envelope } = require('./errors.js');

function call(name, data) {
  return new Promise(function (resolve) {
    if (!wx.cloud) {
      resolve(envelope(50003, null));
      return;
    }
    wx.getNetworkType({
      success: function (res) {
        if (res.networkType === 'none') {
          resolve(envelope('offline', null));
          return;
        }
        run();
      },
      fail: run,
    });

    function run() {
      let settled = false;
      let timer = null;
      let pending;
      try {
        pending = wx.cloud.callFunction({ name: name, data: data });
      } catch (err) {
        resolve(envelope(50003, null));
        return;
      }

      timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        resolve(envelope(50001, null));
      }, CALL_TIMEOUT_MS);

      Promise.resolve(pending)
        .then(function (res) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const env = res && res.result;
          if (!env || typeof env.code !== 'number') {
            resolve(envelope(50003, null));
            return;
          }
          resolve({ code: env.code, data: env.data || null, message: env.message || '' });
        })
        .catch(function () {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(envelope(50001, null));
        });
    }
  });
}

module.exports = { call };
