/**
 * 全局 Toast 总线：组件挂在页面根部，行删除后组件不会卸载，用户看得见提示。
 * 回调不进 setData，只留在模块作用域里，由 action 事件按 id 取回执行。
 */
const listeners = [];
let state = { visible: false, text: '', actionText: '', id: 0 };
let actionFn = null;
let timer = null;

function emit() {
  for (let i = 0; i < listeners.length; i += 1) {
    listeners[i](Object.assign({}, state));
  }
}

function clearTimer() {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

function show(options) {
  const opts = options || {};
  clearTimer();
  actionFn = typeof opts.onAction === 'function' ? opts.onAction : null;
  state = {
    visible: true,
    text: typeof opts.text === 'string' ? opts.text : '',
    actionText: typeof opts.actionText === 'string' ? opts.actionText : '',
    id: state.id + 1,
  };
  emit();
  timer = setTimeout(hide, opts.duration || 5000);
}

function hide() {
  clearTimer();
  actionFn = null;
  state = Object.assign({}, state, { visible: false });
  emit();
}

function runAction() {
  const fn = actionFn;
  hide();
  if (fn) fn();
}

function subscribe(fn) {
  if (typeof fn === 'function') listeners.push(fn);
  return function () {
    const idx = listeners.indexOf(fn);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

module.exports = { show, hide, runAction, subscribe };
