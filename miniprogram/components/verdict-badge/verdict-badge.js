/** 判定徽章：颜色 + 图形 + 文字三信号，不只靠颜色传达 */
const MAP = {
  '褒': { cls: 'vb-good', label: '能吃', icon: '/assets/icons/check.svg' },
  '贬': { cls: 'vb-bad', label: '雷', icon: '/assets/icons/cross.svg' },
  '有争议': { cls: 'vb-warn', label: '有争议', icon: '/assets/icons/wave.svg' },
};

Component({
  properties: {
    verdict: { type: String, value: '褒' },
    size: { type: String, value: 'sm' },
  },
  data: { cls: 'vb-good', label: '能吃', icon: '/assets/icons/check.svg' },
  observers: {
    'verdict, size': function (verdict, size) {
      const item = MAP[verdict] || MAP['有争议'];
      this.setData({
        cls: item.cls,
        label: item.label,
        icon: item.icon,
        large: size === 'lg',
      });
    },
  },
});
