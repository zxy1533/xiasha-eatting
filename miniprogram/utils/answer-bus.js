/**
 * why 页与首页之间的轻量传值：navigateTo 的 query 会丢对象，这里用内存 + globalData。
 * 页面被系统回收后 answer 为空，why 页显示降级空态，不白屏（AC-09）。
 */
function setAnswer(answer) {
  const app = getApp();
  app.globalData.lastAnswer = answer || null;
}

function getAnswer() {
  const app = getApp();
  return app.globalData.lastAnswer || null;
}

function requestChangeOne() {
  const app = getApp();
  app.globalData.pendingChangeOne = true;
}

function consumeChangeOne() {
  const app = getApp();
  const pending = app.globalData.pendingChangeOne === true;
  app.globalData.pendingChangeOne = false;
  return pending;
}

module.exports = { setAnswer, getAnswer, requestChangeOne, consumeChangeOne };
