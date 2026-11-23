/** 同学原话卡：纯文本渲染，超长折叠，不接富文本 */
Component({
  properties: {
    text: { type: String, value: '' },
  },
  data: { expanded: false, long: false },
  observers: {
    text: function (text) {
      this.setData({ long: String(text || '').length > 60, expanded: false });
    },
  },
  methods: {
    toggle: function () {
      this.setData({ expanded: !this.data.expanded });
    },
  },
});
