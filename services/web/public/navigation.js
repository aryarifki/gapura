const DEFAULT_ROUTE = Object.freeze({ view: 'view-overview' });
const ROUTE_STATE_KEY = 'gapuraRoute';
const VALID_VIEWS = new Set([
  'view-overview', 'view-review', 'view-topics', 'view-sources', 'view-trends',
  'view-studio-prompt', 'view-agents', 'view-n8n',
  'view-tokens', 'view-audit',
]);

export function parseRoute(hash = '') {
  const [view, resource, id] = String(hash).replace(/^#\/?/, '').split('/');
  if (!VALID_VIEWS.has(view)) return { ...DEFAULT_ROUTE };
  if (view === 'view-review' && resource === 'draft' && /^\d+$/.test(id || '') && Number.isSafeInteger(Number(id)) && Number(id) > 0) return { view, draftId: Number(id) };
  if (resource) return { ...DEFAULT_ROUTE };
  return { view };
}

export function routeHash(route) {
  const view = VALID_VIEWS.has(route?.view) ? route.view : DEFAULT_ROUTE.view;
  const draftId = String(route?.draftId || '');
  return view === 'view-review' && /^\d+$/.test(draftId)
    ? `#${view}/draft/${Number(draftId)}`
    : `#${view}`;
}

export function createNavigationController({ window: browserWindow, onNavigate = () => {} }) {
  if (!browserWindow) throw new TypeError('A browser window is required');

  let route = parseRoute(browserWindow.location.hash);
  let initialized = false;

  const commit = (next, { replace = false, notify = true } = {}) => {
    if (routeHash(next) === routeHash(route)) {
      if (notify) onNavigate({ ...route });
      return { ...route };
    }
    route = parseRoute(routeHash(next));
    const state = { [ROUTE_STATE_KEY]: route };
    const method = replace ? 'replaceState' : 'pushState';
    browserWindow.history[method](state, '', routeHash(route));
    if (notify) onNavigate({ ...route });
    return { ...route };
  };

  const handlePopState = (event) => {
    const stateRoute = event.state?.[ROUTE_STATE_KEY];
    route = parseRoute(routeHash(stateRoute || parseRoute(browserWindow.location.hash)));
    onNavigate({ ...route });
  };

  return {
    initialize() {
      if (initialized) return { ...route };
      initialized = true;
      route = parseRoute(browserWindow.location.hash);
      const initialRoute = route;
      if (!browserWindow.history.state?.[ROUTE_STATE_KEY]) {
        const parentRoute = route.draftId ? { view: 'view-review' } : route;
        browserWindow.history.replaceState({ [ROUTE_STATE_KEY]: parentRoute }, '', routeHash(parentRoute));
        if (routeHash(initialRoute) !== routeHash(parentRoute)) browserWindow.history.pushState({ [ROUTE_STATE_KEY]: initialRoute }, '', routeHash(initialRoute));
      }
      browserWindow.addEventListener('popstate', handlePopState);
      onNavigate({ ...route });
      return { ...route };
    },
    navigate(next, options) {
      if (!initialized) this.initialize();
      return commit(next, options);
    },
    back(fallback) {
      browserWindow.history.back();
      return fallback ? { ...fallback } : { ...route };
    },
    current() {
      return { ...route };
    },
    destroy() {
      browserWindow.removeEventListener('popstate', handlePopState);
      initialized = false;
    },
  };
}
