/** 我的清单：本地 storage 增删，Toast 可撤销；Toast 宿主在页面根部不随行卸载 */
const { readAll, remove, restore } = require('../../services/storage.js');
const toast = require('../../utils/toast.js');

Page({
  data: { items: [], total: 0 },

  onShow: function () {
    this.reload();
  },

  reload: function () {
    const items = readAll();
    this.setData({ items: items, total: items.length });
  },

  removeItem: function (event) {
    const self = this;
    const id = event.currentTarget.dataset.id;
    const result = remove(id);
    if (!result.ok || !result.removed) {
      toast.show({ text: '没删掉，再点一次' });
      return;
    }
    this.reload();
    const removed = result.removed;
    const index = result.index;
    toast.show({
      text: '删了，可撤销',
      actionText: '撤销',
      duration: 5000,
      onAction: function () {
        restore(removed, index);
        self.reload();
        toast.show({ text: '已经放回来了' });
      },
    });
  },

  gotoAvoid: function () {
    wx.switchTab({ url: '/pages/avoid/avoid' });
  },
});
