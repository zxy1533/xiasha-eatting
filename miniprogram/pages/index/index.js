/** 首页：提问 → 打字机答案 → 为什么 / 换一家（红笔划掉 + 残影） */
const { ask } = require('../../services/recommend.js');
const { checkUsage } = require('../../services/usage.js');
const { scenarioOf } = require('../../services/errors.js');
const bus = require('../../utils/answer-bus.js');

const EXAMPLES = ['省钱又快', '想吃辣的', '堂食别踩雷'];
const MAX_GHOSTS = 3;
const STRIKE_MS = 300; // motion.strike
const CAROUSEL_IMAGES = [
  '/assets/images/carousel-1.jpg',
  '/assets/images/carousel-2.jpg',
  '/assets/images/carousel-3.jpg',
  '/assets/images/carousel-4.jpg',
  '/assets/images/carousel-5.jpg',
  '/assets/images/carousel-6.jpg',
  '/assets/images/carousel-7.jpg',
  '/assets/images/carousel-8.jpg',
];

Page({
  data: {
    question: '',
    examples: EXAMPLES,
    carouselImages: CAROUSEL_IMAGES,
    usage: null,
    scenario: '',
    busy: false,
    blocked: false,
    fading: false,
    answer: null, // {summary, restaurants:[{restaurant_id, restaurant_name, reason, evidence, verdict}]}
    ghosts: [],
    excludeIds: [],
    ghostSeq: 0,
  },

  onLoad: function () {
    this.refreshUsage();
  },

  onShow: function () {
    this.refreshUsage();
    if (bus.consumeChangeOne()) {
      const self = this;
      setTimeout(function () { self.changeOne(); }, 60);
    }
  },

  refreshUsage: function () {
    const self = this;
    checkUsage().then(function (env) {
      if (env.code !== 0 || !env.data) {
        self.setData({ scenario: scenarioOf(env.code) });
        return;
      }
      const u = env.data;
      self.setData({
        usage: u,
        scenario: '',
        blocked: u.global_stopped === true ||
          (typeof u.daily_remaining === 'number' && u.daily_remaining <= 0),
      });
    });
  },

  onCarouselTap: function () {
    wx.switchTab({ url: '/pages/avoid/avoid' });
  },

  onInput: function (event) {
    this.setData({ question: event.detail.value });
  },

  pickExample: function (event) {
    this.setData({ question: event.currentTarget.dataset.text });
  },

  onTipAction: function (event) {
    const kind = event.detail.kind;
    if (kind === 'gotoavoid') {
      wx.switchTab({ url: '/pages/avoid/avoid' });
    } else if (kind === 'retry') {
      this.refreshUsage();
      this.ask();
    }
  },

  ask: function () {
    if (this.data.busy || this.data.blocked) return;
    this.runAsk();
  },

  runAsk: function () {
    const self = this;
    const question = String(this.data.question || '').trim();
    if (!question) {
      this.setData({ scenario: 'invalid' });
      return;
    }

    this.setData({ busy: true, fading: false, scenario: '', answer: null });
    ask({
      question: question,
      exclude: this.data.excludeIds.slice(),
      sessionId: getApp().globalData.sessionId,
    }).then(function (env) {
      if (env.code !== 0 || !env.data || !env.data.answer) {
        self.setData({ busy: false, scenario: scenarioOf(env.code) });
        return;
      }
      const data = env.data;
      const answer = data.answer;
      const usage = self.data.usage
        ? Object.assign({}, self.data.usage, { daily_remaining: data.daily_remaining })
        : self.data.usage;
      // openapi.yaml: exclude 最多 20 项，多店时把这一批店都加进排除，超出裁掉最早的
      const ids = (answer.restaurants || []).map(function (r) { return r.restaurant_id; });
      const excludes = self.data.excludeIds.concat(ids).slice(-20);
      self.setData({
        busy: false,
        answer: answer,
        excludeIds: excludes,
        usage: usage,
        scenario: data.degraded ? scenarioOf(50002) : '',
        blocked: !!usage && (usage.global_stopped === true ||
          (typeof usage.daily_remaining === 'number' && usage.daily_remaining <= 0)),
      });
    });
  },

  changeOne: function () {
    const self = this;
    const current = this.data.answer;
    if (this.data.busy) return;

    let ghosts = this.data.ghosts.slice();
    const names = current && current.restaurants ? current.restaurants.map(function (r) { return r.restaurant_name; }) : [];
    if (names.length > 0) {
      ghosts = ghosts.map(function (g) { return Object.assign({}, g, { fresh: false }); });
      let seq = this.data.ghostSeq;
      names.forEach(function (name) {
        seq += 1;
        ghosts.push({ key: 'g' + seq, name: name, fresh: true });
      });
      while (ghosts.length > MAX_GHOSTS) ghosts.shift();
      this.setData({ ghosts: ghosts, ghostSeq: seq, fading: true, busy: true });
      setTimeout(function () { self.setData({ answer: null }); }, 200);
    } else {
      this.setData({ busy: true });
    }

    setTimeout(function () {
      const q = String(self.data.question || '').trim() || '随便来一家';
      self.setData({ question: q });
      self.runAsk();
    }, STRIKE_MS);
  },

  goWhy: function (event) {
    const answer = this.data.answer;
    if (!answer || !answer.restaurants) return;
    const index = Number((event && event.currentTarget && event.currentTarget.dataset.index)) || 0;
    const single = answer.restaurants[index] || answer.restaurants[0];
    if (!single) return;
    // why 页取的是单店对象，不是整个多店 answer，这样 why.js 无需大改
    bus.setAnswer(single);
    wx.navigateTo({ url: '/pages/why/why' });
  },
});
