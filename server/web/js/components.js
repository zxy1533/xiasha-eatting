/**
 * 渲染原子：图标（内联 SVG，currentColor）、verdict 徽章、原话卡、usage 提示条、打字机。
 * 所有动态文本经 esc() 转义后插入 innerHTML，杜绝注入。
 */
(function (EatWhat) {
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // 自绘线性图标（24×24 viewBox，currentColor 描边；quote 为填充）
  var ICONS = {
    bowl:     { stroke: '<path d="M3 11h18a9 9 0 0 1-18 0Z"/><path d="M8 7.5c0-1 1-1.4 1-2.5M12 7.5c0-1 1-1.4 1-2.5M16 7.5c0-1 1-1.4 1-2.5"/>' },
    search:   { stroke: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>' },
    bookmark: { stroke: '<path d="M6 3.5h12v17l-6-4-6 4v-17Z"/>' },
    clock:    { stroke: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.5l3.5 2"/>' },
    info:     { stroke: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8h.01"/>' },
    warn:     { stroke: '<path d="M12 3.5 2.5 20h19L12 3.5Z"/><path d="M12 9.5v4.5M12 17.2h.01"/>' },
    refresh:  { stroke: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4v5h-5"/>' },
    back:     { stroke: '<path d="m15 4-8 8 8 8"/>' },
    close:    { stroke: '<path d="m6 6 12 12M18 6 6 18"/>' },
    circle:   { stroke: '<path d="M20.4 12.6c-.4 4.4-4.2 7.4-8.7 7.2-4.6-.2-8.1-3.6-7.9-8 .2-4.5 4-7.8 8.6-7.6 4.3.2 7.8 3.2 8 7.3"/>' },
    cross:    { stroke: '<path d="m5.5 5.5 13 13M18.5 5.5l-13 13"/>' },
    check:    { stroke: '<path d="m4 12.5 5 5L20 6.5"/>' },
    wave:     { stroke: '<path d="M2.5 12c2-3 4 3 6 0s4 3 6 0 4 3 7 0"/>' },
    quote:    { fill: '<path d="M9 6.2C6.2 7.5 4.6 10 4.6 13.4H9V19H3.4v-5.6c0-4.7 2.1-7.2 5.6-8.6V6.2Zm11 0c-2.8 1.3-4.4 3.8-4.4 7.2H20V19h-5.6v-5.6c0-4.7 2.1-7.2 5.6-8.6V6.2Z"/>' },
  };

  function icon(name, cls) {
    var def = ICONS[name];
    if (!def) return '';
    var attrs;
    var body;
    if (def.fill) {
      attrs = 'fill="currentColor"';
      body = def.fill;
    } else {
      attrs = 'fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"';
      body = def.stroke;
    }
    return '<svg class="ic' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true" ' + attrs + '>' + body + '</svg>';
  }

  // verdict 徽章：颜色 + 图形 + 文字三信号
  var VERDICT = {
    '褒': { cls: 'vb-good', label: '能吃', icon: 'check' },
    '贬': { cls: 'vb-bad', label: '雷', icon: 'cross' },
    '有争议': { cls: 'vb-warn', label: '有争议', icon: 'wave' },
  };

  function verdictBadge(verdict, size) {
    var v = VERDICT[verdict] || VERDICT['有争议'];
    var lg = size === 'lg' ? ' vb-lg' : '';
    return '<span class="vb ' + v.cls + lg + '">' + icon(v.icon) + '<span>' + v.label + '</span></span>';
  }

  // 原话卡：超长折叠（>60 字）
  function evidenceCard(text) {
    var t = String(text || '');
    var long = t.length > 60;
    return '<div class="ec">' +
      icon('quote', 'ec-quote') +
      '<span class="ec-text' + (long ? ' ec-clamp' : '') + '">' + esc(t) + '</span>' +
      (long ? '<button class="ec-more" data-action="toggle-evidence">展开</button>' : '') +
      '</div>';
  }

  // 打字机：每字 animation-delay 错开，reduced-motion 由全局媒体查询直接跳终态
  function streamHtml(text, cls, delayMs) {
    var source = String(text || '');
    var base = Number(delayMs) || 0;
    var out = '<span class="as' + (cls ? ' ' + cls : '') + '">';
    for (var i = 0; i < source.length; i += 1) {
      out += '<span class="as-char" style="animation-delay:' + (base + i * 28) + 'ms">' + esc(source[i]) + '</span>';
    }
    out += '</span>';
    return out;
  }

  // —— 用量 / 降级提示（DESIGN §7.5） ——
  var TIP_TABLE = {
    normal:      { tone: 'info', icon: 'info', actionText: '', action: '' },
    low:         { tone: 'warning', icon: 'warn', actionText: '', action: '' },
    daily_full:  { tone: 'danger', icon: 'warn', actionText: '去查店', action: 'gotoavoid' },
    month_cap:   { tone: 'danger', icon: 'warn', actionText: '去查店', action: 'gotoavoid' },
    timeout:     { tone: 'warning', icon: 'warn', actionText: '再试一次', action: 'retry' },
    invalid:     { tone: 'warning', icon: 'info', actionText: '', action: '' },
    rate:        { tone: 'warning', icon: 'warn', actionText: '', action: '' },
    offline:     { tone: 'danger', icon: 'warn', actionText: '重试', action: 'retry' },
    unavailable: { tone: 'danger', icon: 'warn', actionText: '', action: '' },
  };

  var TIP_COPY = {
    daily_full: '今天的次数用完了，明天再来。查店还能用',
    month_cap: '这个月大家问得太多，机器人先歇会儿。查店照常',
    timeout: '今天有点忙，等下再问一次',
    invalid: '这次没挑出来，换个说法试试',
    rate: '慢点问，歇十秒',
    offline: '没网了，连上再说',
    unavailable: '服务暂不可用',
  };

  function usageTip(usage, scenario) {
    var key = scenario || '';
    if (!key || key === 'normal') {
      if (usage && usage.global_stopped === true) key = 'month_cap';
      else if (usage && typeof usage.daily_remaining === 'number' && usage.daily_remaining <= 0) key = 'daily_full';
      else if (usage && typeof usage.daily_remaining === 'number' && usage.daily_remaining <= 3) key = 'low';
      else key = 'normal';
    }
    var conf = TIP_TABLE[key] || TIP_TABLE.unavailable;
    var text = TIP_COPY[key] || '';
    if (key === 'normal') {
      text = (usage && typeof usage.daily_remaining === 'number')
        ? '今天还能问 ' + usage.daily_remaining + ' 次'
        : '今天随便问，不限次数';
    } else if (key === 'low') {
      var n = (usage && typeof usage.daily_remaining === 'number') ? usage.daily_remaining : 3;
      text = '就剩 ' + n + ' 次了，省着点换';
    }
    var html = '<div class="ut ut-' + conf.tone + '">' + icon(conf.icon, 'ut-icon') + '<span class="ut-text">' + esc(text) + '</span>';
    if (conf.actionText) {
      html += '<button class="ut-action" data-action="tip-action" data-kind="' + conf.action + '">' + esc(conf.actionText) + '</button>';
    }
    html += '</div>';
    return html;
  }

  // 错误码 → scenario
  var SCENARIO = {
    40301: 'daily_full',
    40302: 'month_cap',
    42901: 'rate',
    50001: 'timeout',
    50002: 'invalid',
    50003: 'unavailable',
    offline: 'offline',
  };
  function scenarioOf(code) { return SCENARIO[code] || 'normal'; }

  EatWhat.ui = {
    esc: esc,
    icon: icon,
    verdictBadge: verdictBadge,
    evidenceCard: evidenceCard,
    streamHtml: streamHtml,
    usageTip: usageTip,
    scenarioOf: scenarioOf,
  };
})(window.EatWhat = window.EatWhat || {});
