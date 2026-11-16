import test from 'node:test';
import assert from 'node:assert/strict';
import { createNavigationController } from '../public/navigation.js';

function browser(hash = '') {
  let index = 0;
  const entries = [{ state: null, hash }];
  const handlers = new Map();
  const w = {
    location: { hash },
    addEventListener: (type, handler) => handlers.set(type, handler),
    removeEventListener: (type) => handlers.delete(type),
    history: {
      get state() { return entries[index].state; },
      replaceState(state, _, hash) { entries[index] = { state, hash }; w.location.hash = hash; },
      pushState(state, _, hash) { entries.splice(++index); entries[index] = { state, hash }; w.location.hash = hash; },
      back() { if (index > 0) { index--; w.location.hash = entries[index].hash; handlers.get('popstate')?.({ state: entries[index].state }); } },
      forward() { if (index + 1 < entries.length) { index++; w.location.hash = entries[index].hash; handlers.get('popstate')?.({ state: entries[index].state }); } },
    },
    depth: () => entries.length,
  };
  return w;
}

test('sidebar and draft transitions restore the previous page through a real history stack', () => {
  const w = browser();
  let rendered;
  const router = createNavigationController({ window: w, onNavigate: (route) => { rendered = route; } });
  router.initialize();
  router.navigate({ view: 'view-topics' });
  router.navigate({ view: 'view-review' });
  router.navigate({ view: 'view-review', draftId: 21 });
  router.back();
  assert.deepEqual(rendered, { view: 'view-review' });
  router.back();
  assert.deepEqual(rendered, { view: 'view-topics' });
  w.history.forward();
  assert.deepEqual(rendered, { view: 'view-review' });
});

test('reselecting the current page and refreshing do not grow history', () => {
  const w = browser('#view-topics');
  const router = createNavigationController({ window: w });
  router.initialize();
  const initialDepth = w.depth();
  router.navigate({ view: 'view-topics' });
  router.destroy();
  createNavigationController({ window: w }).initialize();
  assert.equal(w.depth(), initialDepth);
});

test('a draft deep link returns to gallery once and rejects draft resource on other views', async () => {
  const w = browser('#view-review/draft/21');
  const router = createNavigationController({ window: w });
  router.initialize();
  router.back();
  assert.deepEqual(router.current(), { view: 'view-review' });
  router.navigate({ view: 'view-topics', draftId: 21 });
  assert.deepEqual(router.current(), { view: 'view-topics' });
});
