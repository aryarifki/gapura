import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createZip } from '../export.js';

test('ZIP package extracts ordered PNG and caption contents with valid CRC', () => {
  const zip = createZip([{ name: 'slide_1.png', data: Buffer.from([0, 1, 2, 255]) }, { name: 'caption.txt', data: 'Naskah Gapura 2,1%\n#GapuraMedia' }]);
  const report = execFileSync('python3', ['-c', "import io,sys,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; assert z.read('slide_1.png')==bytes([0,1,2,255]); print(z.read('caption.txt').decode())"], { input: zip, encoding: 'utf8' });
  assert.match(report, /Naskah Gapura 2,1%/);
});
