/**
 * 路由 + 引导 + 全局事件委托。
 * hash 路由： #/ (index) / #/avoid / #/mine / #/why。
 */
(function (EatWhat) {
  var routes = {
    index: EatWhat.views.index,
    avoid: EatWhat.views.avoid,
    mine: EatWhat.views.mine,
    why: EatWhat.views.why,
  };

  function currentRoute() {
    var path = (window.location.hash || '#/').replace(/^#\/?/, '');
    if (!path) path = 'index';
    return routes[path] ? path : 'index';
  }

  function render() {
    var route = currentRoute();
    EatWhat.router.current = route;
    var view = routes[route];

    document.getElementById('topbar-title').textContent = view.title;
    document.getElementById('topbar-back').hidden = !view.back;

    var tabbar = document.getElementById('tabbar');
    tabbar.hidden = !view.tab;
    if (view.tab) {
      var tabs = tabbar.querySelectorAll('.tab');
      for (var i = 0; i < tabs.length; i += 1) {
        tabs[i].classList.toggle('tab--active', tabs[i].getAttribute('data-route') === route);
      }
    }

    var content = document.getElementById('view');
    content.innerHTML = view.render();
    if (view.mount) view.mount(content);
    window.scrollTo(0, 0);
  }

  function navigate(route) {
    window.location.hash = '#/' + (route === 'index' ? '' : route);
  }

  EatWhat.router = { current: 'index', render: render, navigate: navigate };
  EatWhat.refresh = render;

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]');
    if (!el) return;
    EatWhat.handleAction(el.getAttribute('data-action'), el);
  });

  document.addEventListener('input', function (e) {
    var el = e.target.closest('[data-input]');
    if (!el) return;
    EatWhat.handleInput(el.getAttribute('data-input'), el);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    var el = e.target.closest('[data-enter]');
    if (!el) return;
    e.preventDefault();
    EatWhat.handleAction(el.getAttribute('data-enter'), el);
  });

  window.addEventListener('hashchange', render);
  render();
})(window.EatWhat = window.EatWhat || {});
