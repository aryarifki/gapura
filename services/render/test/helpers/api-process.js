// A separate process replaces expensive rendering and forbids outbound requests.
// Only this disposable test process listens; the running render service is untouched.
import http from 'node:http';
import path from 'node:path';
import { RenderEngine } from '../../engine.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/FrcAAAAASUVORK5CYII=', 'base64');
globalThis.fetch = async () => { throw new Error('External requests disabled in tests'); };
RenderEngine.prototype.renderSlideToBuffer = async (slide) => {
  if (slide.teks === 'simulate render failure') throw new Error('/private/storage/secret rendering detail');
  return png;
};
RenderEngine.prototype.renderCarouselToDisk = async (id, slides, output) => {
  if (slides[0].teks === 'simulate render failure') throw new Error('/private/storage/secret rendering detail');
  return slides.map((slide, index) => ({ slide_no: index + 1, layout: slide.layout || 'cover-stat', file_path: path.join(output, String(id), `slide_${index + 1}.png`), render_time_ms: 1 }));
};
const listen = http.Server.prototype.listen;
http.Server.prototype.listen = function (...args) {
  this.once('listening', () => process.send({ port: this.address().port }));
  return listen.apply(this, args);
};
await import('../../server.js');
