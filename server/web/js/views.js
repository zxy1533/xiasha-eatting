/**
 * 四个视图 + 全局事件分发。
 * 渲染全部返回 HTML 字符串；动态文本经 ui.esc() 转义；输入不触发整页重渲，保住焦点。
 */
(function (EatWhat) {
  var ui = EatWhat.ui;
  var store = EatWhat.store;
  var toast = EatWhat.toast;

  function refresh() {
    if (EatWhat.refresh) EatWhat.refresh();
  }

  /* ============================================================
     首页「吃什么」
     ============================================================ */
  var EXAMPLES = ['省钱又快', '想吃辣的', '堂食别踩雷'];
  var MAX_GHOSTS = 3;
  var STRIKE_MS = 300;

  var indexState = {
    question: '',
    usage: null,
    scenario: '',
    busy: false,
    blocked: false,
    fading: false,
    answer: null,
    ghosts: [],
    excludeIds: [],
    ghostSeq: 0,
    usageLoaded: false,
    focusInput: false,
  };

  function answerCardHtml(answer, fading) {
    var html = '<div class="u-card idx-answer' + (fading ? ' idx-fade' : '') + '">';
    if (answer.summary) html += ui.streamHtml(answer.summary, 'idx-summary', 0);
    answer.restaurants.forEach(function (r, i) {
      html += '<div class="idx-shop' + (i === 0 ? ' idx-shop-first' : '') + '">';
      html += '<div class="idx-title-row">' + ui.icon('circle', 'idx-circle') +
        '<span class="idx-display">' + ui.esc(r.restaurant_name) + '</span></div>';
      html += '<span class="idx-reason">' + ui.esc(r.reason) + '</span>';
      html += '<div class="idx-badge-row">' + ui.verdictBadge(r.verdict, 'lg') + '</div>';
      html += '<div class="idx-evidence">';
      r.evidence.forEach(function (ev) {
        html += '<div class="idx-eq">' + ui.evidenceCard(ev) + '</div>';
      });
      html += '</div>';
      html += '<button class="u-btn-secondary idx-why-btn" data-action="index-why" data-index="' + i + '" aria-label="为什么推荐它">为什么推荐它</button>';
      html += '</div>';
    });
    html += '<div class="idx-actions">' +
      '<button class="u-btn-secondary" data-action="index-changeone" aria-label="换一家">' +
      ui.icon('refresh', 'idx-refresh') + '<span>换一家</span></button></div>';
    html += '<span class="u-caption">换一家也算问一次</span>';
    html += '</div>';
    return html;
  }

  function renderIndex() {
    var btnText = indexState.busy ? '翻小抄中…' : (indexState.blocked ? '今天的次数用完了' : '定一家');
    var btnDisabled = indexState.busy || indexState.blocked;

    var html = '<div id="idx-usage">' +
      ((indexState.usage || indexState.scenario) ? ui.usageTip(indexState.usage, indexState.scenario) : '') +
      '</div>';

    // 美食轮播（高清中餐图，视觉钩子）；仅在无答案时展示，出答案后让位给结果
    if (EatWhat.carouselHtml && !indexState.answer) {
      html += EatWhat.carouselHtml();
    }

    html += '<div class="idx-head"><span class="idx-lead">别挑了，说一句想吃啥</span></div>';

    html += '<div class="idx-input-wrap">' +
      '<input class="idx-input" id="idx-question" type="text" value="' + ui.esc(indexState.question) + '"' +
      ' placeholder="比如：辣一点，别太贵" maxlength="200" data-input="index-question" data-enter="index-ask" aria-label="想吃什么" /></div>';

    html += '<button class="u-btn-primary idx-submit' + (btnDisabled ? ' u-btn-disabled' : '') + '"' +
      ' data-action="index-ask" ' + (btnDisabled ? 'disabled' : '') + ' aria-label="定一家">' +
      (indexState.busy ? '' : ui.icon('bowl', 'idx-bowl')) + '<span>' + btnText + '</span></button>';

    html += '<div class="idx-chips">';
    EXAMPLES.forEach(function (t) {
      html += '<button class="u-chip" data-action="index-example" data-text="' + ui.esc(t) + '" aria-label="填入 ' + ui.esc(t) + '">' + ui.esc(t) + '</button>';
    });
    html += '</div><span class="u-hint idx-help">不知道怎么说？点一句试试</span>';

    if (indexState.ghosts.length) {
      html += '<div class="idx-ghosts">';
      indexState.ghosts.forEach(function (g) {
        html += '<div class="ghost' + (g.fresh ? ' ghost-fresh' : '') + '">' +
          '<span class="ghost-name">' + ui.esc(g.name) + '</span>' +
          '<span class="ghost-line"></span>' +
          '<span class="ghost-note">划掉这家</span></div>';
      });
      html += '</div>';
    }

    if (indexState.busy) {
      html += '<div class="idx-loading"><span class="u-hint">在表里翻哪个能吃…</span></div>';
    }

    if (indexState.answer) html += answerCardHtml(indexState.answer, indexState.fading);

    return html;
  }

  function loadUsage() {
    EatWhat.api.usage().then(function (env) {
      if (env && env.code === 0 && env.data) {
        indexState.usage = env.data;
        indexState.scenario = '';
      } else {
        indexState.usage = null;
        indexState.scenario = ui.scenarioOf(env && env.code);
      }
      indexState.blocked = !!(indexState.usage && indexState.usage.global_stopped === true);
      var tipEl = document.getElementById('idx-usage');
      if (tipEl) tipEl.innerHTML = ui.usageTip(indexState.usage, indexState.scenario);
      var btn = document.querySelector('#view .idx-submit');
      if (btn) {
        var disabled = indexState.busy || indexState.blocked;
        btn.disabled = disabled;
        if (disabled) btn.classList.add('u-btn-disabled'); else btn.classList.remove('u-btn-disabled');
        var span = btn.querySelector('span');
        if (span) span.textContent = indexState.busy ? '翻小抄中…' : (indexState.blocked ? '今天的次数用完了' : '定一家');
      }
    });
  }

  function mountIndex() {
    if (EatWhat.mountCarousel) EatWhat.mountCarousel();
    if (!indexState.usageLoaded) {
      indexState.usageLoaded = true;
      loadUsage();
    }
    if (indexState.focusInput) {
      indexState.focusInput = false;
      var inp = document.getElementById('idx-question');
      if (inp) inp.focus();
    }
    if (store.consumeChangeOne()) {
      setTimeout(function () { changeOne(); }, 60);
    }
  }

  function indexAsk() {
    if (indexState.busy || indexState.blocked) return;
    runAsk();
  }

  function runAsk() {
    var question = String(indexState.question || '').trim();
    if (!question) {
      indexState.scenario = 'invalid';
      refresh();
      return;
    }
    indexState.busy = true;
    indexState.fading = false;
    indexState.scenario = '';
    indexState.answer = null;
    refresh();

    EatWhat.api.recommend(question, indexState.excludeIds.slice()).then(function (env) {
      if (!env || env.code !== 0 || !env.data || !env.data.answer) {
        indexState.busy = false;
        indexState.scenario = ui.scenarioOf(env && env.code);
        refresh();
        return;
      }
      var answer = env.data.answer;
      var ids = (answer.restaurants || []).map(function (r) { return r.restaurant_id; });
      indexState.excludeIds = indexState.excludeIds.concat(ids).slice(-20);
      indexState.answer = answer;
      indexState.busy = false;
      if (indexState.usage) {
        indexState.usage = Object.assign({}, indexState.usage, { daily_remaining: env.data.daily_remaining });
      }
      indexState.scenario = env.data.degraded ? 'invalid' : '';
      refresh();
    });
  }

  function changeOne() {
    var current = indexState.answer;
    if (indexState.busy) return;

    var ghosts = indexState.ghosts.slice();
    var names = (current && current.restaurants) ? current.restaurants.map(function (r) { return r.restaurant_name; }) : [];
    if (names.length) {
      ghosts = ghosts.map(function (g) { return Object.assign({}, g, { fresh: false }); });
      var seq = indexState.ghostSeq;
      names.forEach(function (name) {
        seq += 1;
        ghosts.push({ key: 'g' + seq, name: name, fresh: true });
      });
      while (ghosts.length > MAX_GHOSTS) ghosts.shift();
      indexState.ghosts = ghosts;
      indexState.ghostSeq = seq;
      indexState.fading = true;
      indexState.busy = true;
      refresh();
      setTimeout(function () {
        indexState.answer = null;
        indexState.fading = false;
        refresh();
      }, 200);
    } else {
      indexState.busy = true;
      refresh();
    }

    setTimeout(function () {
      var q = String(indexState.question || '').trim() || '随便来一家';
      indexState.question = q;
      runAsk();
    }, STRIKE_MS);
  }

  function indexGoWhy(el) {
    var answer = indexState.answer;
    if (!answer || !answer.restaurants) return;
    var idx = Number(el.getAttribute('data-index')) || 0;
    var single = answer.restaurants[idx] || answer.restaurants[0];
    if (!single) return;
    store.setAnswer(single);
    store.setReturnRoute('index');
    EatWhat.router.navigate('why');
  }

  /* ============================================================
     避雷查询
     ============================================================ */
  var AVOID_CHIPS = ['纸包鸡', '稻川岛滑蛋饭', '嗨将东北盒饭'];

  var avoidState = {
    query: '',
    result: null,
    searched: false,
    scenario: '',
    busy: false,
  };

  function renderAvoid() {
    var savedIds = store.readAll().map(function (it) { return it.id; });

    var html = '<div class="av-search">' + ui.icon('search', 'av-search-icon') +
      '<input class="av-input" id="av-query" type="text" value="' + ui.esc(avoidState.query) + '"' +
      ' placeholder="查一家店，看有没有人踩过雷" maxlength="40" data-input="avoid-query" data-enter="avoid-search" aria-label="查店名或商圈" />' +
      '<button class="av-go" data-action="avoid-search" ' + (avoidState.busy ? 'disabled' : '') + ' aria-label="查这家店">查</button></div>';

    html += '<div class="av-chips-title"><span class="u-caption">常被查的</span></div>';
    html += '<div class="av-chips">';
    AVOID_CHIPS.forEach(function (t) {
      html += '<button class="u-chip" data-action="avoid-chip" data-text="' + ui.esc(t) + '" aria-label="查询 ' + ui.esc(t) + '">' + ui.esc(t) + '</button>';
    });
    html += '</div><span class="u-hint av-honest">表里没有的店，我们不会瞎编</span>';

    if (avoidState.scenario) {
      html += '<div class="ut-wrap">' + ui.usageTip(null, avoidState.scenario) + '</div>';
    }

    if (avoidState.searched && avoidState.result && !avoidState.result.found) {
      html += '<div class="av-empty"><span class="av-empty-title">表里没有这家</span>' +
        '<span class="u-hint">换个写法试试，或者这家还没人踩过</span>' +
        '<button class="u-btn-secondary av-empty-btn" data-action="avoid-gotoindex" aria-label="让机器人帮我定">让机器人帮我定</button></div>';
    }

    if (avoidState.searched && avoidState.result && avoidState.result.found) {
      html += '<div class="av-results">';
      avoidState.result.matches.forEach(function (m) {
        var saved = savedIds.indexOf(m.id) >= 0;
        html += '<div class="u-card av-match">' +
          '<div class="av-match-head"><span class="av-name">' + ui.esc(m.name) + '</span>' + ui.verdictBadge(m.verdict) + '</div>' +
          '<span class="u-caption av-source">' + ui.esc(m.source_sheet) + ' · ' + m.mention_count + ' 条提及</span>' +
          '<div class="av-evidence">';
        m.evidence.forEach(function (ev) {
          html += '<div class="av-eq">' + ui.evidenceCard(ev) + '</div>';
        });
        html += '</div><div class="av-match-actions">' +
          '<button class="u-btn-secondary" data-action="avoid-save" data-id="' + ui.esc(m.id) + '" ' + (saved ? 'disabled' : '') + ' aria-label="存进清单">' +
          ui.icon('bookmark', 'av-icon') + '<span>' + (saved ? '已在清单' : '存进清单') + '</span></button>' +
          '<button class="u-btn-secondary" data-action="avoid-why" data-id="' + ui.esc(m.id) + '" aria-label="看原话">看原话</button>' +
          '</div></div>';
      });
      html += '</div>';
    }

    return html;
  }

  function avoidSearch() {
    var query = String(avoidState.query || '').trim();
    if (!query) {
      avoidState.scenario = 'invalid';
      refresh();
      return;
    }
    avoidState.busy = true;
    avoidState.scenario = '';
    refresh();

    EatWhat.api.avoid(query).then(function (env) {
      if (!env || env.code !== 0 || !env.data) {
        avoidState.busy = false;
        avoidState.searched = false;
        avoidState.scenario = ui.scenarioOf(env && env.code);
        refresh();
        return;
      }
      avoidState.busy = false;
      avoidState.searched = true;
      avoidState.scenario = '';
      avoidState.result = env.data;
      refresh();
    });
  }

  function avoidFind(id) {
    var matches = (avoidState.result && avoidState.result.matches) || [];
    for (var i = 0; i < matches.length; i += 1) { if (matches[i].id === id) return matches[i]; }
    return null;
  }

  function avoidSave(el) {
    var target = avoidFind(el.getAttribute('data-id'));
    if (!target) return;
    var result = store.add({ id: target.id, name: target.name, verdict: target.verdict });
    if (!result.ok && result.reason === 'exists') { toast.show({ text: '这家已经在清单里了' }); return; }
    if (!result.ok) { toast.show({ text: '没存上，再点一次' }); return; }
    refresh();
    toast.show({ text: '已存进清单' });
  }

  function avoidWhy(el) {
    var target = avoidFind(el.getAttribute('data-id'));
    if (!target) return;
    store.setAnswer({
      restaurant_id: target.id,
      restaurant_name: target.name,
      verdict: target.verdict,
      reason: target.evidence[0] || '表里没有更多原话了',
      evidence: target.evidence,
    });
    store.setReturnRoute('avoid');
    EatWhat.router.navigate('why');
  }

  /* ============================================================
     我的清单
     ============================================================ */
  function renderMine() {
    var items = store.readAll();
    var html = '<div class="mine-head"><span class="mine-title">我攒的店</span><span class="mine-count u-num">' + items.length + '</span></div>';
    html += '<span class="u-hint">只存在这台手机上，换个手机就没了</span>';

    if (items.length === 0) {
      html += '<div class="mine-empty"><span class="u-hint">还没攒店。查到能吃的，点书签存这儿。</span>' +
        '<button class="u-btn-secondary mine-empty-btn" data-action="mine-gotoavoid" aria-label="去查店">去查店</button></div>';
    } else {
      html += '<div class="mine-list">';
      items.forEach(function (it) {
        html += '<div class="mine-row">' +
          '<span class="mine-name">' + ui.esc(it.name) + '</span>' +
          ui.verdictBadge(it.verdict) +
          '<button class="mine-del" data-action="mine-remove" data-id="' + ui.esc(it.id) + '" aria-label="删除 ' + ui.esc(it.name) + '">' + ui.icon('close') + '</button></div>';
      });
      html += '</div>';
    }
    return html;
  }

  function mineRemove(el) {
    var id = el.getAttribute('data-id');
    var result = store.remove(id);
    if (!result.ok || !result.removed) { toast.show({ text: '没删掉，再点一次' }); return; }
    refresh();
    var removed = result.removed;
    var index = result.index;
    toast.show({
      text: '删了，可撤销',
      actionText: '撤销',
      duration: 5000,
      onAction: function () {
        store.restore(removed, index);
        refresh();
        toast.show({ text: '已经放回来了' });
      },
    });
  }

  /* ============================================================
     为什么推荐
     ============================================================ */
  function renderWhy() {
    var answer = store.getAnswer();
    if (!answer || !answer.restaurant_name) {
      return '<div class="why-empty"><span class="why-empty-title">这次没挑出理由，换个说法再问</span>' +
        '<button class="u-btn-secondary why-empty-btn" data-action="why-back" aria-label="返回">返回</button></div>';
    }
    var disputed = answer.verdict === '有争议';
    var saved = store.has(answer.restaurant_id);

    var html = '<div class="why-head"><span class="why-name">' + ui.esc(answer.restaurant_name) + '</span>' +
      ui.verdictBadge(answer.verdict, 'lg') + '</div>';
    html += '<span class="why-subtitle">凭什么推荐它</span>';
    html += '<span class="why-reason">' + ui.esc(answer.reason) + '</span>';
    if (disputed) html += '<div class="why-disputed">这家有争议，夸的和骂的都有，自己掂量</div>';
    html += '<span class="u-caption why-note">都是同学原话，名字抹掉了</span>';
    html += '<div class="why-evidence">';
    (answer.evidence || []).forEach(function (ev) {
      html += '<div class="why-eq">' + ui.evidenceCard(ev) + '</div>';
    });
    html += '</div>';
    html += '<div class="why-actions">' +
      '<button class="u-btn-primary" data-action="why-save" ' + (saved ? 'disabled' : '') + ' aria-label="就吃这家，存进清单">' + (saved ? '已在清单' : '就吃这家，存进清单') + '</button>' +
      '<button class="u-btn-secondary" data-action="why-changeone" aria-label="换一家">换一家</button>' +
      '</div>';
    return html;
  }

  function whySave() {
    var answer = store.getAnswer();
    if (!answer) return;
    var result = store.add({ id: answer.restaurant_id, name: answer.restaurant_name, verdict: answer.verdict });
    if (!result.ok && result.reason === 'exists') { toast.show({ text: '这家已经在清单里了' }); return; }
    if (!result.ok) { toast.show({ text: '没存上，再点一次' }); return; }
    refresh();
    toast.show({ text: '已存进清单' });
  }

  function whyChangeOne() {
    store.setPendingChangeOne();
    EatWhat.router.navigate(store.getReturnRoute());
  }

  /* ============================================================
     全局动作
     ============================================================ */
  function toggleEvidence(el) {
    var ec = el.closest('.ec');
    if (!ec) return;
    var text = ec.querySelector('.ec-text');
    var more = ec.querySelector('.ec-more');
    if (!text) return;
    var wasClamped = text.classList.contains('ec-clamp');
    text.classList.toggle('ec-clamp');
    if (more) more.textContent = wasClamped ? '收起' : '展开';
  }

  function handleTipAction(kind) {
    if (kind === 'gotoavoid') { EatWhat.router.navigate('avoid'); return; }
    if (kind === 'retry') {
      if (EatWhat.router.current === 'avoid') { avoidSearch(); }
      else { loadUsage(); runAsk(); }
    }
  }

  EatWhat.views = {
    index: { title: '吃什么', back: false, tab: true, render: renderIndex, mount: mountIndex },
    avoid: { title: '避雷', back: false, tab: true, render: renderAvoid },
    mine:  { title: '清单', back: false, tab: true, render: renderMine },
    why:   { title: '为什么推荐它', back: true, tab: false, render: renderWhy },
  };

  EatWhat.handleAction = function (action, el) {
    switch (action) {
      case 'nav': EatWhat.router.navigate(el.getAttribute('data-route')); break;
      case 'back': EatWhat.router.navigate(store.getReturnRoute()); break;
      case 'toggle-evidence': toggleEvidence(el); break;
      case 'toast-action': toast.runAction(); break;
      case 'toast-close': toast.hide(); break;
      case 'tip-action': handleTipAction(el.getAttribute('data-kind')); break;
      case 'index-ask': indexAsk(); break;
      case 'index-example':
        indexState.question = el.getAttribute('data-text') || '';
        indexState.focusInput = true;
        refresh();
        break;
      case 'index-changeone': changeOne(); break;
      case 'index-why': indexGoWhy(el); break;
      case 'avoid-search': avoidSearch(); break;
      case 'avoid-chip':
        avoidState.query = el.getAttribute('data-text') || '';
        avoidSearch();
        break;
      case 'avoid-save': avoidSave(el); break;
      case 'avoid-why': avoidWhy(el); break;
      case 'avoid-gotoindex': EatWhat.router.navigate('index'); break;
      case 'mine-remove': mineRemove(el); break;
      case 'mine-gotoavoid': EatWhat.router.navigate('avoid'); break;
      case 'why-save': whySave(); break;
      case 'why-changeone': whyChangeOne(); break;
      case 'why-back': EatWhat.router.navigate(store.getReturnRoute()); break;
    }
  };

  EatWhat.handleInput = function (name, el) {
    if (name === 'index-question') indexState.question = el.value;
    else if (name === 'avoid-query') avoidState.query = el.value;
  };
})(window.EatWhat = window.EatWhat || {});
