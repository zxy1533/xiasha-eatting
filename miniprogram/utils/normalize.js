/**
 * 店名归一化：只用于前端查询/展示匹配，不参与打分、不产出推荐。
 * 打分与拍板全部在云函数由大模型完成（brief §0 第 1 条）。
 */
function normalizeName(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\uFF01-\uFF5E]/g, function (ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
    })
    .replace(/\s+/g, '')
    .replace(/[（(]\s*\d+\s*[)）]/g, '')
    .trim()
    .toLowerCase();
}

function matchRestaurant(restaurant, query) {
  const q = normalizeName(query);
  if (!q) return false;
  if (normalizeName(restaurant.name).indexOf(q) >= 0) return true;
  const tags = Array.isArray(restaurant.tags) ? restaurant.tags : [];
  for (let i = 0; i < tags.length; i += 1) {
    if (normalizeName(tags[i]).indexOf(q) >= 0) return true;
  }
  return false;
}

module.exports = { normalizeName, matchRestaurant };
