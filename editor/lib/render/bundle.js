/**
 * Layout bundle zips in and out. readBundle() unpacks an uploaded zip into a fresh
 * work dir and returns its manifest, refusing anything the installer must never
 * touch: path traversal (extract-zip), symbolic links, a missing manifest, a
 * non-slug id, or a builtin's id. zipBundle() packs an installed bundle for
 * download, cached by checksum so a bundle is zipped once.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const extract = require('extract-zip');
const archiver = require('archiver');
const yauzl = require('yauzl');
const { AppError } = require('../errors');
const { loadLayout, assertNoSymlinks } = require('./loader');
const { CV_LAYOUTS_DIR } = require('./layouts');
const { SLUG_PATTERN } = require('@cv/constants');
const { limits, QuotaError } = require('../quota');

const SLUG_RE = new RegExp(SLUG_PATTERN);

// A bundle root is the dir holding the manifest — either the zip root, or a
// single top-level folder inside it (the common "zip of a folder" shape).
function findBundleRoot(dir) {
  if (fs.existsSync(path.join(dir, 'layout.json'))) return dir;
  const subdirs = fs.readdirSync(dir).filter((n) => {
    try {
      return fs.statSync(path.join(dir, n)).isDirectory();
    } catch {
      return false;
    }
  });
  if (subdirs.length === 1 && fs.existsSync(path.join(dir, subdirs[0], 'layout.json'))) {
    return path.join(dir, subdirs[0]);
  }
  return null;
}

/**
 * Read the zip's directory without unpacking it, and refuse one whose files would
 * unpack past the size or file-count limit (a small zip can expand enormously).
 * yauzl checks each entry's real size against the directory while extracting, so
 * a zip that understates its sizes fails extraction instead.
 */
function assertUnpackedSize(zipPath) {
  const { bundleBytes, bundleFiles } = limits();
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(new AppError('Could not read the zip: ' + err.message, 400));
      let bytes = 0;
      let files = 0;
      const fail = (e) => {
        zip.close();
        reject(e);
      };
      zip.on('entry', (entry) => {
        files++;
        bytes += entry.uncompressedSize;
        if (files > bundleFiles)
          return fail(new QuotaError(`The zip holds more than ${bundleFiles} files`));
        if (bytes > bundleBytes)
          return fail(
            new QuotaError(`The zip unpacks to more than ${Math.round(bundleBytes / 1048576)} MB`),
          );
        zip.readEntry();
      });
      zip.on('end', () => resolve({ bytes, files }));
      zip.on('error', (e) => reject(new AppError('Could not read the zip: ' + e.message, 400)));
      zip.readEntry();
    });
  });
}

/**
 * Unpack `zipPath` and validate it as a layout bundle.
 * @returns {Promise<{work: string, root: string, manifest: object}>} the caller removes `work`
 * @throws AppError (400 unreadable zip, 409 builtin id, 422 invalid bundle)
 */
async function readBundle(zipPath, db) {
  await assertUnpackedSize(zipPath);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'layout-bundle-'));
  try {
    try {
      await extract(zipPath, { dir: work });
    } catch (e) {
      throw new AppError('Could not read the zip: ' + e.message, 400);
    }
    try {
      assertNoSymlinks(work);
    } catch (e) {
      throw new AppError('Invalid bundle: ' + e.message, 422);
    }
    const root = findBundleRoot(work);
    if (!root)
      throw new AppError(
        'Zip must contain a layout.json (at its root or in a single top-level folder)',
        422,
      );
    let manifest;
    try {
      ({ manifest } = loadLayout(root));
    } catch (e) {
      throw new AppError('Invalid bundle: ' + e.message, 422);
    }
    if (typeof manifest.id !== 'string' || !SLUG_RE.test(manifest.id)) {
      throw new AppError(`Manifest id must match ${SLUG_PATTERN}`, 422);
    }
    const builtin = db.getLayout(manifest.id, null);
    if (builtin && builtin.source === 'builtin') {
      throw new AppError(
        `"${manifest.id}" is the id of a builtin layout and cannot be overwritten`,
        409,
      );
    }
    return { work, root, manifest };
  } catch (e) {
    fs.rmSync(work, { recursive: true, force: true });
    throw e;
  }
}

/** A zip of the bundle at `dir`, cached under CV_LAYOUTS_DIR/.zips by checksum. */
function zipBundle(dir, checksum) {
  const cacheDir = path.join(CV_LAYOUTS_DIR, '.zips');
  const file = path.join(cacheDir, `${checksum}.zip`);
  if (checksum && fs.existsSync(file)) return Promise.resolve(file);
  fs.mkdirSync(cacheDir, { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(tmp);
    const zip = archiver('zip', { zlib: { level: 9 } });
    out.on('close', () => {
      fs.renameSync(tmp, file);
      resolve(file);
    });
    zip.on('error', (e) => {
      fs.rmSync(tmp, { force: true });
      reject(e);
    });
    zip.pipe(out);
    zip.directory(dir, false);
    zip.finalize();
  });
}

/** Bytes on disk under `dir`; a symbolic link counts as its own size. */
function dirBytes(dir) {
  let total = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.lstatSync(full);
    total += st.isDirectory() ? dirBytes(full) : st.size;
  }
  return total;
}

/** Drop a cached zip once no layout row uses its checksum any more. */
function forgetZip(checksum, stillUsed) {
  if (!checksum || stillUsed) return;
  fs.rmSync(path.join(CV_LAYOUTS_DIR, '.zips', `${checksum}.zip`), { force: true });
}

module.exports = {
  readBundle,
  zipBundle,
  findBundleRoot,
  forgetZip,
  assertUnpackedSize,
  dirBytes,
};
