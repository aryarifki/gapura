import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { iconNameForGlyph } from '../public/icon-map.js';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const sprite = readFileSync(new URL('../public/lucide-sprite.svg', import.meta.url), 'utf8');
const attribute = (attributes, name) => attributes.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1];
const decodeNumericEntities = (text) => text.replace(/&#(x[\da-f]+|\d+);/gi, (_, value) => (
  String.fromCodePoint(value.toLowerCase().startsWith('x') ? parseInt(value.slice(1), 16) : Number(value))
));

test('maps dashboard symbols to official Lucide icon names', () => {
  assert.equal(iconNameForGlyph('📊'), 'chart-no-axes-column');
  assert.equal(iconNameForGlyph('🎯'), 'target');
  assert.equal(iconNameForGlyph('🛡️'), 'shield-check');
});

test('does not treat unknown glyphs as a Lucide icon', () => {
  assert.equal(iconNameForGlyph('💥'), null);
  assert.equal(iconNameForGlyph(''), null);
});

test('newsroom markup opens directly without admin login or an inert app', () => {
  assert.doesNotMatch(html, /admin-access-|access-gate|access-panel|Akses Admin|Token admin/);
  const app = html.match(/<div\b[^>]*class="app-container"[^>]*>/)?.[0];
  assert.ok(app);
  assert.doesNotMatch(app, /\binert\b/, 'The newsroom must be interactive before JavaScript initializes');
});

test('static dashboard markup has no decorative emoji or arrow glyphs', () => {
  const glyphs = decodeNumericEntities(html).match(/[\p{Extended_Pictographic}☰◀▶●✕←↗→•❮❯\uFE0F]/gu) || [];
  assert.deepEqual([...new Set(glyphs)], [], 'Use explicit Lucide SVGs instead of static decorative glyphs');
});

test('static icons reference available local Lucide symbols and are decorative', () => {
  const symbols = new Set([...sprite.matchAll(/<symbol\b[^>]*\bid="([^"]+)"/g)].map((match) => match[1]));
  const icons = [...html.matchAll(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/g)];
  assert.ok(icons.length > 0, 'The static dashboard must render icons without relying on the emoji observer');
  for (const [, attributes, content] of icons) {
    assert.ok(attribute(attributes, 'class')?.split(/\s+/).includes('ui-icon'));
    assert.equal(attribute(attributes, 'aria-hidden'), 'true');
    assert.equal(attribute(attributes, 'focusable'), 'false');
    assert.equal(attribute(attributes, 'viewBox'), '0 0 24 24');
    const name = content.match(/<use\b[^>]*\bhref="\/lucide-sprite\.svg#([a-z0-9-]+)"/)?.[1];
    assert.ok(symbols.has(name), `Unknown or missing Lucide symbol: ${name}`);
  }
  assert.doesNotMatch(html, /\bdata-(?:lucide|icon)=/, 'Do not leave unmounted static icon placeholders');
  const studioTab = html.match(/<button\b[^>]*data-agent="studio"[^>]*>([\s\S]*?)<\/button>/)?.[1];
  assert.match(studioTab || '', /href="\/lucide-sprite\.svg#clapperboard"/);
});

test('sidebar views use native keyboard-operable buttons and retain their route targets', () => {
  const nav = html.match(/<nav\b[^>]*class="sidebar-nav"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
  assert.ok(nav);
  const items = [...nav.matchAll(/<(\w+)\b([^>]*\bdata-view="([^"]+)"[^>]*)>/g)];
  assert.deepEqual(items.map((item) => item[3]), [
    'view-overview', 'view-review', 'view-topics', 'view-sources', 'view-trends',
    'view-studio-prompt', 'view-agents', 'view-n8n', 'view-tokens', 'view-audit',
  ]);
  for (const [, tag, attributes, view] of items) {
    assert.equal(tag, 'button', `${view} must support Tab, Enter, and Space natively`);
    assert.equal(attribute(attributes, 'type'), 'button');
    assert.ok(attribute(attributes, 'class')?.split(/\s+/).includes('nav-item'));
  }
});

test('icon-only controls have accessible names and hover titles', () => {
  const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
  const iconOnly = buttons.filter(([, , content]) => !/[\p{Letter}\p{Number}]/u.test(decodeNumericEntities(
    content.replace(/<svg\b[\s\S]*?<\/svg>/g, '').replace(/<[^>]*>/g, ''),
  )));
  assert.ok(iconOnly.length > 0);
  for (const [, attributes] of iconOnly) {
    const name = attribute(attributes, 'id') || attribute(attributes, 'onclick');
    assert.ok(attribute(attributes, 'aria-label')?.trim(), `${name} needs an accessible name`);
    assert.ok(attribute(attributes, 'title')?.trim(), `${name} needs a hover title`);
  }
});

test('carousel navigation uses directional Lucide symbols', () => {
  for (const [id, name] of [
    ['btn-slide-prev', 'arrow-left'], ['btn-slide-next', 'arrow-right'],
    ['btn-studio-prev-slide', 'arrow-left'], ['btn-studio-next-slide', 'arrow-right'],
  ]) {
    const content = html.match(new RegExp(`<button\\b[^>]*id="${id}"[^>]*>([\\s\\S]*?)<\\/button>`))?.[1];
    assert.ok(content?.includes(`href="/lucide-sprite.svg#${name}"`), `${id} must use ${name}`);
  }
});

test('trend health live status and its update targets remain present', () => {
  const banner = html.match(/<div\b([^>]*\bid="trend-health-banner"[^>]*)>([\s\S]*?)<\/div>/);
  assert.ok(banner);
  assert.equal(attribute(banner[1], 'role'), 'status');
  assert.equal(attribute(banner[1], 'aria-live'), 'polite');
  assert.match(banner[2], /id="trend-health-message"/);
  assert.match(banner[2], /id="trend-health-last-success"/);
});
