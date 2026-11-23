/**
 * 打字机渲染容器（SPEC §6.6：非流式答案逐字显示）。
 * 每字延迟交给 WXSS animation-delay，JS 只切字：
 * reduced-motion 由全局 @media 让所有字直接跳到终态，内容不会消失。
 */
const MS_PER_CHAR = 28; // design-tokens.json motion.typewriter.msPerChar

Component({
  properties: {
    text: { type: String, value: '' },
    delayMs: { type: Number, value: 0 },
    cls: { type: String, value: '' },
  },
  data: { chars: [] },
  observers: {
    'text, delayMs': function (text, delayMs) {
      const source = typeof text === 'string' ? text : '';
      const base = Number(delayMs) || 0;
      const chars = source.split('').map(function (ch, i) {
        return { c: ch, ms: base + i * MS_PER_CHAR };
      });
      this.setData({ chars: chars });
    },
  },
});
