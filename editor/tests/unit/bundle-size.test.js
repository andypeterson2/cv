const fs = require('fs');
const os = require('os');
const path = require('path');
const archiver = require('archiver');
const { assertUnpackedSize } = require('../../lib/render/bundle');

function writeZip(file, entries) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(file);
    const zip = archiver('zip', { zlib: { level: 9 } });
    out.on('close', resolve);
    zip.on('error', reject);
    zip.pipe(out);
    for (const [name, content] of entries) zip.append(content, { name });
    zip.finalize();
  });
}

describe('assertUnpackedSize', () => {
  let dir;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-size-'));
    process.env.CV_BUNDLE_MAX_MB = '1';
    process.env.CV_BUNDLE_MAX_FILES = '10';
  });
  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.CV_BUNDLE_MAX_MB;
    delete process.env.CV_BUNDLE_MAX_FILES;
  });

  test('accepts a small bundle', async () => {
    const file = path.join(dir, 'ok.zip');
    await writeZip(file, [['layout.json', '{}']]);
    await expect(assertUnpackedSize(file)).resolves.toMatchObject({ files: 1 });
  });

  test('refuses a tiny zip that unpacks past the size limit', async () => {
    const file = path.join(dir, 'bomb.zip');
    await writeZip(file, [['zeros.bin', Buffer.alloc(3 * 1024 * 1024)]]);
    expect(fs.statSync(file).size).toBeLessThan(50_000);
    await expect(assertUnpackedSize(file)).rejects.toMatchObject({
      status: 413,
      code: 'quota_exceeded',
    });
  });

  test('refuses a zip with too many files', async () => {
    const file = path.join(dir, 'many.zip');
    await writeZip(
      file,
      Array.from({ length: 12 }, (_, i) => [`f${i}.txt`, 'x']),
    );
    await expect(assertUnpackedSize(file)).rejects.toThrow(/more than 10 files/);
  });
});
