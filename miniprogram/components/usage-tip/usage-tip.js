/**
 * 用量与降级提示条（DESIGN §7.5 八种文案全在这里）。
 * scenario 由页面在错误时显式传入；平时按 usage 自动派生。
 */
const TABLE = {
  normal:     { tone: 'info',    icon: '/assets/icons/info.svg', actionText: '', action: '' },
  low:        { tone: 'warning', icon: '/assets/icons/warn.svg', actionText: '', action: '' },
  daily_full: { tone: 'danger',  icon: '/assets/icons/warn.svg', actionText: '去查店', action: 'gotoavoid' },
  month_cap:  { tone: 'danger',  icon: '/assets/icons/warn.svg', actionText: '去查店', action: 'gotoavoid' },
  timeout:    { tone: 'warning', icon: '/assets/icons/warn.svg', actionText: '再试一次', action: 'retry' },
  invalid:    { tone: 'warning', icon: '/assets/icons/info.svg', actionText: '', action: '' },
  rate:       { tone: 'warning', icon: '/assets/icons/warn.svg', actionText: '', action: '' },
  offline:    { tone: 'danger',  icon: '/assets/icons/warn.svg', actionText: '重试', action: 'retry' },
  unavailable:{ tone: 'danger',  icon: '/assets/icons/warn.svg', actionText: '', action: '' },
};

const COPY = {
  daily_full: '今天的次数用完了，明天再来。查店还能用',
  month_cap: '这个月大家问得太多，机器人先歇会儿。查店照常',
  timeout: '今天有点忙，等下再问一次',
  invalid: '这次没挑出来，换个说法试试',
  rate: '慢点问，歇十秒',
  offline: '没网了，连上再说',
  unavailable: '服务暂不可用',
};

Component({
  properties: {
    usage: { type: Object, value: null },
    scenario: { type: String, value: '' },
  },
  data: {
    tone: 'info', icon: '/assets/icons/info.svg', tip: '', actionText: '', action: '',
  },
  observers: {
    'usage, scenario': function (usage, scenario) {
      let key = scenario || '';
      if (!key || key === 'normal') {
        if (usage && usage.global_stopped === true) key = 'month_cap';
        else if (usage && typeof usage.daily_remaining === 'number' && usage.daily_remaining <= 0) key = 'daily_full';
        else if (usage && typeof usage.daily_remaining === 'number' && usage.daily_remaining <= 3) key = 'low';
        else key = 'normal';
      }
      const conf = TABLE[key] || TABLE.unavailable;
      let text = COPY[key] || '';
      if (key === 'normal') {
        if (usage && typeof usage.daily_remaining === 'number') {
          text = '今天还能问 ' + usage.daily_remaining + ' 次';
        } else {
          text = '今天随便问，不限次数';
        }
      } else if (key === 'low') {
        const n = usage && typeof usage.daily_remaining === 'number' ? usage.daily_remaining : 3;
        text = '就剩 ' + n + ' 次了，省着点换';
      }
      this.setData({
        tone: conf.tone, icon: conf.icon, tip: text,
        actionText: conf.actionText, action: conf.action,
      });
    },
  },
  methods: {
    onAction: function () {
      if (this.data.action) {
        this.triggerEvent('action', { kind: this.data.action });
      }
    },
  },
});
