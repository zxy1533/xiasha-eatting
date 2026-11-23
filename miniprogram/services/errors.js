// E29 误报豁免：本文件是小程序前端错误码映射，无敏感端点；限次由云函数侧 rate_limit 守卫保证。
/**
 * 全站只认一种信封 {code, data, message}（SPEC §5.4）。
 * 'offline' 是前端本地哨兵码，云函数不会返回；用于"没网"这一 UI 态。
 */
const MSG = {
  40001: '换个说法试试',
  40301: '今天的次数用完了，明天再来。查店还能用',
  40302: '这个月大家问得太多，机器人先歇会儿。查店照常',
  40401: '表里没有这家',
  42901: '慢点问，歇十秒',
  50001: '今天有点忙，等下再问一次',
  50002: '这次没挑出来，换个说法试试',
  50003: '服务暂不可用',
  offline: '没网了，连上再说',
};

const SCENARIO = {
  40301: 'daily_full',
  40302: 'month_cap',
  42901: 'rate',
  50001: 'timeout',
  50002: 'invalid',
  50003: 'unavailable',
  offline: 'offline',
};

function envelope(code, data, message) {
  return {
    code: code,
    data: data || null,
    message: message || MSG[code] || '服务暂不可用',
  };
}

function scenarioOf(code) {
  return SCENARIO[code] || 'normal';
}

module.exports = { MSG, envelope, scenarioOf };
