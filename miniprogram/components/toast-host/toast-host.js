/** 全局 Toast 宿主：挂在页面根部，删除清单行后不会随行卸载 */
const toast = require('../../utils/toast.js');

Component({
  data: { visible: false, text: '', actionText: '' },
  lifetimes: {
    attached: function () {
      this._off = toast.subscribe(function (state) {
        this.setData({ visible: state.visible, text: state.text, actionText: state.actionText });
      }.bind(this));
    },
    detached: function () {
      if (this._off) this._off();
    },
  },
  methods: {
    onAction: function () {
      toast.runAction();
    },
    onHide: function () {
      toast.hide();
    },
  },
});
