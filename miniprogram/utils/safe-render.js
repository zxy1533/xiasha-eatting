/**
 * 边界处的纯文本清洗：WXML 只用 text 组件渲染，不用富文本组件，避免注入。
 * 只做"进入应用时"的一次处理；组件内部信任已清洗过的数据。
 */
const MAX_LEN = 200;

function toSafeText(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .slice(0, MAX_LEN);
}

function safeEvidence(value) {
  if (!Array.isArray(value)) return [];
  return value.map(toSafeText).filter(function (s) { return s.length > 0; }).slice(0, 10);
}

module.exports = { toSafeText, safeEvidence };
