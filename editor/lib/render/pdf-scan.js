/**
 * PDF safety scan for compiled layout output. A layout can write raw PDF objects
 * through \special, so its PDF may carry scripts, auto-run actions or embedded
 * files that the person sending the résumé never sees. qpdf decodes every object
 * (object streams included) into JSON, and the scan walks the dictionaries for
 * keys and action types that have no place in a résumé.
 *
 * scanPdf() resolves null when qpdf is not installed, so callers can report the
 * check as skipped.
 */
const { execFile } = require('child_process');

const FORBIDDEN_KEYS = new Set([
  '/JavaScript',
  '/JS',
  '/AA',
  '/EmbeddedFiles',
  '/EmbeddedFile',
  '/RichMedia',
  '/XFA',
]);
const FORBIDDEN_ACTIONS = new Set([
  '/JavaScript',
  '/Launch',
  '/SubmitForm',
  '/ImportData',
  '/GoToR',
  '/GoToE',
  '/RichMediaExecute',
]);

/** An OpenAction that only moves to a place in the document: an array or object reference destination, or a GoTo. */
function isDestination(v) {
  if (Array.isArray(v) || typeof v === 'string') return true;
  return Boolean(v && typeof v === 'object' && v['/S'] === '/GoTo');
}

/** What one dictionary entry contributes to the forbidden list, if anything. */
function entryProblem(k, v) {
  if (FORBIDDEN_KEYS.has(k)) return k;
  // hyperref opens the document at a page: a destination array or a GoTo is fine.
  if (k === '/OpenAction' && !isDestination(v)) return k;
  if (k === '/S' && FORBIDDEN_ACTIONS.has(v)) return `/S ${v}`;
  return null;
}

/** Dictionary keys and action types in a qpdf JSON v2 object tree that are not allowed. */
function findForbidden(objects) {
  const found = new Set();
  const walk = (v) => {
    if (!v || typeof v !== 'object') return;
    for (const [k, x] of Array.isArray(v) ? v.entries() : Object.entries(v)) {
      const problem = Array.isArray(v) ? null : entryProblem(k, x);
      if (problem) found.add(problem);
      walk(x);
    }
  };
  walk(objects);
  return [...found].sort();
}

function scanPdf(pdfPath) {
  return new Promise((resolve, reject) => {
    execFile(
      'qpdf',
      ['--json=2', '--json-key=qpdf', pdfPath, '-'],
      { maxBuffer: 64 * 1024 * 1024 },
      (err, stdout) => {
        if (err && err.code === 'ENOENT') return resolve(null);
        // qpdf exits 3 for warnings but still prints the JSON.
        if (err && !stdout) return reject(err);
        try {
          const parsed = JSON.parse(stdout);
          resolve({ forbidden: findForbidden(parsed.qpdf && parsed.qpdf[1]) });
        } catch (e) {
          reject(e);
        }
      },
    );
  });
}

module.exports = { scanPdf, findForbidden };
