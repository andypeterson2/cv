const fs = require('fs');
const os = require('os');
const path = require('path');
const { sweepBuildDir, sweepZipCache } = require('../../lib/build-sweep');

const HOUR = 60 * 60 * 1000;

function touch(p, ageMs, isDir = false) {
  if (isDir) fs.mkdirSync(p, { recursive: true });
  else {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, 'x');
  }
  const t = (Date.now() - ageMs) / 1000;
  fs.utimesSync(p, t, t);
}

describe('sweepBuildDir', () => {
  let root;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-'));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  test('removes stale build dirs and their emptied parents, keeps live ones', () => {
    const stale = path.join(root, 'variants', '7', 'cv-abc');
    const live = path.join(root, 'variants', '8', 'cv-def');
    touch(path.join(stale, 'cv.pdf'), 2 * HOUR);
    touch(stale, 2 * HOUR, true);
    touch(path.join(live, 'cv.pdf'), 60_000);
    touch(live, 60_000, true);
    touch(path.join(root, 'variants', '7'), 2 * HOUR, true);

    sweepBuildDir(root);

    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(path.join(root, 'variants', '7'))).toBe(false);
    expect(fs.existsSync(path.join(live, 'cv.pdf'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'variants'))).toBe(true);
  });

  test('a missing build dir is not an error', () => {
    expect(sweepBuildDir(path.join(root, 'nope'))).toBe(0);
  });
});

describe('sweepZipCache', () => {
  test('drops only old half-written zips', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zips-'));
    touch(path.join(dir, 'a.zip.1.2.tmp'), 2 * HOUR);
    touch(path.join(dir, 'b.zip.1.2.tmp'), 1000);
    touch(path.join(dir, 'c.zip'), 3 * HOUR);
    expect(sweepZipCache(dir)).toBe(1);
    expect(fs.readdirSync(dir).sort()).toEqual(['b.zip.1.2.tmp', 'c.zip']);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
