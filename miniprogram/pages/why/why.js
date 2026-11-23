/** 为什么推荐：只摆脱敏原话；有争议时一褒一贬都摆，不藏负面 */
const bus = require('../../utils/answer-bus.js');
const { add, has } = require('../../services/storage.js');
const toast = require('../../utils/toast.js');

Page({
  data: {
    answer: null,
    empty: true,
    disputed: false,
    saved: false,
  },

  onLoad: function () {
    const answer = bus.getAnswer();
    if (!answer || !answer.restaurant_name) {
      this.setData({ answer: null, empty: true });
      return;
    }
    this.setData({
      answer: answer,
      empty: false,
      disputed: answer.verdict === '有争议',
      saved: has(answer.restaurant_id),
    });
  },

  save: function () {
    const answer = this.data.answer;
    if (!answer) return;
    const result = add({
      id: answer.restaurant_id,
      name: answer.restaurant_name,
      verdict: answer.verdict,
    });
    if (!result.ok && result.reason === 'exists') {
      toast.show({ text: '这家已经在清单里了' });
      return;
    }
    if (!result.ok) {
      toast.show({ text: '没存上，再点一次' });
      return;
    }
    this.setData({ saved: true });
    toast.show({ text: '已存进清单' });
  },

  changeOne: function () {
    bus.requestChangeOne();
    wx.navigateBack();
  },

  goBack: function () {
    wx.navigateBack();
  },
});
