/**
 * 全局 Toast 总线：宿主是挂在 body 上的固定覆盖层，删除清单行后不会随行卸载。
 * 文案用 textContent 写入，天然防 XSS。
 */
(function (EatWhat) {
  var el = null;
  var actionFn = null;
  var timer = null;

  function ensureEl() {
    if (el) return el;
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
    return el;
  }

  function hide() {
    if (!el) return;
    el.classList.remove('toast--show');
    if (timer) { clearTimeout(timer); timer = null; }
  }

  function show(options) {
    var opts = options || {};
    actionFn = typeof opts.onAction === 'function' ? opts.onAction : null;
    var host = ensureEl();
    var actionText = typeof opts.actionText === 'string' ? opts.actionText : '';

    var inner = '<span class="toast__text"></span>';
    if (actionText) {
      inner += '<button class="toast__action" data-action="toast-action"></button>';
    } else {
      inner += '<button class="toast__close" data-action="toast-close" aria-label="关闭提示">' +
        '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m6 6 12 12M18 6 6 18"/></svg></button>';
    }
    host.innerHTML = inner;
    host.querySelector('.toast__text').textContent = opts.text || '';
    if (actionText) host.querySelector('.toast__action').textContent = actionText;

    host.classList.add('toast--show');
    if (timer) clearTimeout(timer);
    timer = setTimeout(hide, opts.duration || 5000);
  }

  function runAction() {
    var fn = actionFn;
    hide();
    if (fn) fn();
  }

  EatWhat.toast = { show: show, hide: hide, runAction: runAction };
})(window.EatWhat = window.EatWhat || {});
