// 应用入口：只做注册与全局状态，不写业务
const { USE_MOCK } = require('./services/config.js');

App({
  globalData: {
    appName: '下沙今天吃什么',
    sessionId: '',
    lastAnswer: null,
    pendingChangeOne: false,
  },

  onLaunch() {
    // 生产模式才初始化云开发；env 由工程配置决定，前端不硬编码环境 id
    if (!USE_MOCK && wx.cloud) {
      wx.cloud.init({ traceUser: false });
    }
    let platform = 'wx';
    try {
      const info = wx.getSystemInfoSync();
      platform = info.platform || 'wx';
    } catch (err) {
      platform = 'wx';
    }
    this.globalData.sessionId = 's_' + platform + '_' + Date.now().toString(36);
  },
});
