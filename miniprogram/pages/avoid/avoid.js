/** 避雷查询：查店名/商圈 → verdict + 同学原话；查无则如实空态 */
const { lookup } = require('../../services/avoid.js');
const { scenarioOf } = require('../../services/errors.js');
const { add, readAll } = require('../../services/storage.js');
const toast = require('../../utils/toast.js');
const bus = require('../../utils/answer-bus.js');
const { AVOID_CHIPS } = require('../../mock/restaurants.js');

Page({
  data: {
    query: '',
    chips: AVOID_CHIPS,
    result: null,
    searched: false,
    scenario: '',
    busy: false,
    savedIds: [],
  },

  onShow: function () {
    const savedIds = readAll().map(function (it) { return it.id; });
    this.setData({
      savedIds: savedIds,
      result: this.markSaved(this.data.result, savedIds),
    });
  },

  markSaved: function (result, savedIds) {
    if (!result || !Array.isArray(result.matches)) return result;
    return {
      found: result.found,
      matches: result.matches.map(function (m) {
        return Object.assign({}, m, { saved: savedIds.indexOf(m.id) >= 0 });
      }),
    };
  },

  onInput: function (event) {
    this.setData({ query: event.detail.value });
  },

  pickChip: function (event) {
    const self = this;
    this.setData({ query: event.currentTarget.dataset.text }, function () {
      self.search();
    });
  },

  search: function () {
    const self = this;
    const query = String(this.data.query || '').trim();
    if (!query) {
      this.setData({ scenario: 'invalid' });
      return;
    }
    this.setData({ busy: true, scenario: '' });
    lookup(query).then(function (env) {
      if (env.code !== 0 || !env.data) {
        self.setData({ busy: false, searched: false, scenario: scenarioOf(env.code) });
        return;
      }
      const savedIds = readAll().map(function (it) { return it.id; });
      self.setData({
        busy: false,
        searched: true,
        scenario: '',
        result: self.markSaved(env.data, savedIds),
        savedIds: savedIds,
      });
    });
  },

  gotoIndex: function () {
    wx.switchTab({ url: '/pages/index/index' });
  },

  saveMatch: function (event) {
    const id = event.currentTarget.dataset.id;
    const matches = this.data.result && this.data.result.matches ? this.data.result.matches : [];
    let target = null;
    for (let i = 0; i < matches.length; i += 1) {
      if (matches[i].id === id) target = matches[i];
    }
    if (!target) return;
    const result = add({ id: target.id, name: target.name, verdict: target.verdict });
    if (!result.ok && result.reason === 'exists') {
      toast.show({ text: '这家已经在清单里了' });
      return;
    }
    if (!result.ok) {
      toast.show({ text: '没存上，再点一次' });
      return;
    }
    const savedIds = result.items.map(function (it) { return it.id; });
    this.setData({
      savedIds: savedIds,
      result: this.markSaved(this.data.result, savedIds),
    });
    toast.show({ text: '已存进清单' });
  },

  onTipAction: function (event) {
    if (event.detail.kind === 'retry') this.search();
  },

  goWhy: function (event) {
    const id = event.currentTarget.dataset.id;
    const matches = this.data.result && this.data.result.matches ? this.data.result.matches : [];
    let target = null;
    for (let i = 0; i < matches.length; i += 1) {
      if (matches[i].id === id) target = matches[i];
    }
    if (!target) return;
    bus.setAnswer({
      restaurant_id: target.id,
      restaurant_name: target.name,
      verdict: target.verdict,
      reason: target.evidence[0] || '表里没有更多原话了',
      evidence: target.evidence,
    });
    wx.navigateTo({ url: '/pages/why/why' });
  },
});
