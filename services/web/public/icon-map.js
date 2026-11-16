const ICONS = new Map([
  ['📊', 'chart-no-axes-column'], ['📑', 'files'], ['🎯', 'target'], ['📡', 'radio-tower'],
  ['🔥', 'flame'], ['🛡️', 'shield-check'], ['🎬', 'clapperboard'], ['🤖', 'bot'],
  ['⚡', 'zap'], ['🎨', 'palette'], ['📜', 'scroll-text'], ['🔄', 'refresh-cw'],
  ['✨', 'sparkles'], ['📸', 'camera'], ['⏱️', 'clock'], ['✈️', 'send-horizontal'],
  ['❌', 'circle-x'], ['📋', 'copy'], ['⬇', 'download'], ['🔍', 'search'],
  ['✅', 'circle-check'], ['⚠️', 'triangle-exclamation-point'], ['🚫', 'ban'], ['🚀', 'rocket'],
  ['✏️', 'pencil'], ['➕', 'plus'], ['👁️', 'eye'], ['🔗', 'link'], ['↗', 'external-link'],
  ['🗑️', 'trash'], ['📈', 'trending-up'], ['💾', 'save'], ['⏳', 'loader-circle'],
  ['⚙️', 'settings'], ['🏷️', 'tag'], ['🔤', 'type'], ['📱', 'smartphone'], ['◀', 'arrow-left'],
  ['▶', 'play'], ['⚖️', 'scale'], ['🏛️', 'landmark'], ['💡', 'lightbulb'],
  ['📝', 'notepad-text'], ['⏸️', 'pause'], ['🟢', 'circle-check'], ['⚪', 'circle'],
  ['❔', 'circle-question-mark'], ['📂', 'folder-open'], ['☰', 'menu'], ['🔒', 'lock-keyhole'],
  ['🔑', 'key-round'], ['🏠', 'house'], ['📰', 'newspaper'], ['📡', 'radio-tower'],
  ['•', 'circle'], ['➡', 'arrow-right'], ['🔽', 'chevron-down'], ['📌', 'pin'],
  ['📚', 'library'], ['🧠', 'brain'], ['🧾', 'receipt-text'], ['📅', 'calendar-days'],
  ['🕒', 'clock-3'], ['✉️', 'mail'], ['🔔', 'bell'], ['⭐', 'star'], ['❓', 'circle-question-mark'],
  ['✍️', 'pen-line'], ['⚠', 'triangle-exclamation-point'], ['▶️', 'play'], ['♻️', 'refresh-cw'],
]);

export function iconNameForGlyph(glyph) {
  return ICONS.get(String(glyph || '').trim()) || null;
}

const glyphPattern = /[\p{Extended_Pictographic}](?:\uFE0F|\u200D[\p{Extended_Pictographic}])*(?:\uFE0F)?|•|➡/gu;

function replaceIconText(textNode) {
  if (!textNode.isConnected || !textNode.parentElement) return;
  if (textNode.parentElement?.closest('script,style,textarea,input,option,svg,[data-icon-keep]')) return;
  const value = textNode.nodeValue || '';
  const matches = [...value.matchAll(glyphPattern)]
    .map((match) => ({ glyph: match[0], index: match.index, name: iconNameForGlyph(match[0]) }))
    .filter((match) => match.name);
  if (!matches.length) return;

  const fragment = document.createDocumentFragment();
  let position = 0;
  for (const { glyph, index, name } of matches) {
    fragment.append(document.createTextNode(value.slice(position, index)));
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.classList.add('ui-icon');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('focusable', 'false');
    icon.setAttribute('viewBox', '0 0 24 24');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `/lucide-sprite.svg#${name}`);
    icon.appendChild(use);

    fragment.append(icon);
    position = index + glyph.length;
  }
  fragment.append(document.createTextNode(value.slice(position)));
  textNode.replaceWith(fragment);
}

function replaceTree(root) {
  if (root.nodeType === Node.TEXT_NODE) return replaceIconText(root);
  if (root.nodeType !== Node.ELEMENT_NODE || root.closest('script,style,textarea,input,option,svg')) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(replaceIconText);
}

if (typeof document !== 'undefined') {
  const start = () => {
    replaceTree(document.body);
    new MutationObserver((records) => {
      records.forEach((record) => {
        record.addedNodes.forEach((node) => replaceTree(node));
      });
    }).observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}
