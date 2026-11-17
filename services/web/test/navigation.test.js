import test from 'node:test';
import assert from 'node:assert/strict';
import { createNavigationController, parseRoute, routeHash } from '../public/navigation.js';

function createWindow(hash = '') {
  const listeners = new Map();
  const window = {
    location: { hash },
    history: {
      state: null,
      pushState(state, _title, url) {
        this.state = state;
        window.location.hash = url;
      },
      replaceState(state, _title, url) {
        this.state = state;
        if (url) window.location.hash = url;
      },
      back() {},
    },
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name) { listeners.delete(name); },
    dispatch(name, event = {}) { listeners.get(name)?.(event); },
  };
  return window;
}

test('parses a draft route and safely falls back for unknown routes', () => {
  assert.deepEqual(parseRoute('#view-review/draft/42'), { view: 'view-review', draftId: 42 });
  assert.deepEqual(parseRoute('#view-missing'), { view: 'view-overview' });
  assert.deepEqual(parseRoute('#view-review/draft/not-an-id'), { view: 'view-overview' });
});

test('retired verification routes fall back to the overview instead of opening an empty page', () => {
  assert.deepEqual(parseRoute('#view-verifications'), { view: 'view-overview' });
  assert.equal(routeHash({ view: 'view-verifications' }), '#view-overview');
  const window = createWindow('#view-verifications');
  const router = createNavigationController({ window });
  assert.deepEqual(router.initialize(), { view: 'view-overview' });
  assert.equal(window.location.hash, '#view-overview');
  router.destroy();
});

test('serializes route state without losing the draft identifier', () => {
  assert.equal(routeHash({ view: 'view-review', draftId: 42 }), '#view-review/draft/42');
  assert.equal(routeHash({ view: 'view-topics' }), '#view-topics');
});

test('browser back restores the prior SPA view instead of leaving the app', () => {
  const window = createWindow();
  const visited = [];
  const router = createNavigationController({ window, onNavigate: (route) => visited.push(route) });

  router.initialize();
  router.navigate({ view: 'view-topics' });
  router.navigate({ view: 'view-review' });
  window.location.hash = '#view-topics';
  window.dispatch('popstate', { state: { gapuraRoute: { view: 'view-topics' } } });

  assert.deepEqual(router.current(), { view: 'view-topics' });
  assert.deepEqual(visited.at(-1), { view: 'view-topics' });
  router.destroy();
});

test('browser back from a draft restores the review gallery route', () => {
  const window = createWindow('#view-review');
  const visited = [];
  const router = createNavigationController({ window, onNavigate: (route) => visited.push(route) });

  router.initialize();
  router.navigate({ view: 'view-review', draftId: 17 });
  router.back({ view: 'view-review' });
  window.location.hash = '#view-review';
  window.dispatch('popstate', { state: { gapuraRoute: { view: 'view-review' } } });

  assert.deepEqual(router.current(), { view: 'view-review' });
  assert.deepEqual(visited.at(-1), { view: 'view-review' });
  router.destroy();
});
