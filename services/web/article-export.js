import { normalizeArticleUrl } from '../scout/sources.js';

const json = (value) => typeof value === 'string' ? JSON.parse(value) : value;
const text = (value) => typeof value === 'string' ? value.trim() : '';
const list = (value) => { const parsed = json(value); return Array.isArray(parsed) ? parsed : []; };
const HASHTAG = /#[\p{L}\p{N}_]+/gu;
const TRAILING_HASHTAGS = /(?:^|\s)((?:#[\p{L}\p{N}_]+\s*)+)$/u;

export function exportCaption(draft) {
  const caption = text(draft.caption_body) || text(draft.caption);
  const suffix = caption.match(TRAILING_HASHTAGS);
  const body = suffix ? caption.slice(0, suffix.index).trimEnd() : caption;
  const canonical = list(draft.hashtags).filter((tag) => typeof tag === 'string' && /^#[\p{L}\p{N}_]+$/u.test(tag));
  const tags = canonical.length ? canonical : suffix?.[1].match(HASHTAG) || [];
  const seen = new Set((body.match(HASHTAG) || []).map((tag) => tag.toLocaleLowerCase('id')));
  const unique = tags.filter((tag) => {
    const key = tag.toLocaleLowerCase('id');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return [body, unique.join(' ')].filter(Boolean).join('\n\n');
}

function articleHeadline(draft, story) {
  const slides = list(draft.slides);
  const cover = slides.find((slide) => slide.role === 'cover' || /^(?:cover-|editorial-cover)/u.test(slide.layout)) || slides[0];
  const headline = [story?.headline, cover?.data?.title, cover?.teks, draft.topic_title]
    .map((value) => text(value).replace(/\s+/gu, ' ').replace(/^#+\s*/u, ''))
    .find((value) => value && !/^(?:artikel lengkap|berita terbaru|judul(?: artikel| berita)?|headline|cover|tanpa judul|untitled)[.!:]*$/iu.test(value));
  if (!headline) throw new Error('Judul artikel belum tersedia. Lengkapi judul sebelum ekspor.');
  return headline;
}

function storyBlocks(story) {
  return [story?.lead, ...list(story?.takeaways), ...list(story?.sections).flatMap((section) => list(section.paragraphs))].filter(Boolean);
}

function bibliography(draft, story) {
  // Keep facts and their claim references intact; only the public source list is deduplicated.
  const input = json(draft.editorial_input);
  const facts = new Map([...list(input?.facts), ...list(draft.article_facts)].map((fact) => [fact.id, fact]));
  const ids = [...list(draft.article_references), ...storyBlocks(story).flatMap((block) => list(block.fact_ids))];
  const seen = new Set();
  return ids.flatMap((id) => {
    const fact = facts.get(id);
    const url = normalizeArticleUrl(fact?.source_url);
    if (!url || seen.has(url)) return [];
    seen.add(url);
    const label = (text(fact.source_name) || new URL(url).hostname).replace(/[\\[\]]/gu, '\\$&');
    return [`- [${label}](<${url}>)`];
  }).join('\n');
}

export function exportArticle(draft) {
  const metadata = json(draft.article_metadata);
  const story = metadata?.editorial_version === 2 ? metadata : null;
  const sections = list(story?.sections);
  const structured = text(story?.lead?.text) && sections.some((section) => list(section.paragraphs).some((paragraph) => text(paragraph.text)));
  const body = structured ? [
    text(story.meta_description) ? `> ${text(story.meta_description)}` : '',
    text(story.lead.text),
    list(story.takeaways).length ? `## Poin utama\n\n${list(story.takeaways).map((item) => `- ${text(item.text)}`).join('\n')}` : '',
    ...sections.map((section) => [`## ${text(section.heading)}`, ...list(section.paragraphs).map((paragraph) => text(paragraph.text))].filter(Boolean).join('\n\n')),
  ].filter(Boolean).join('\n\n') : text(draft.article_body);
  if (!body) return null;
  const sources = bibliography(draft, story);
  return [`# ${articleHeadline(draft, story)}`, body, sources ? `## Referensi\n\n${sources}` : ''].filter(Boolean).join('\n\n') + '\n';
}

export function buildDraftTextFiles(draft) {
  const files = [{ name: 'caption.txt', data: exportCaption(draft) }];
  const article = exportArticle(draft);
  if (article) files.push({ name: 'article.md', data: article });
  const metadata = json(draft.article_metadata);
  if (Array.isArray(metadata?.threads_posts) && metadata.threads_posts.length) {
    files.push({ name: 'threads.txt', data: metadata.threads_posts.map((post) => `${post.no}. ${text(post.text)}`).join('\n\n') + '\n' });
  }
  return files;
}
