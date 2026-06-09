const express = require('express');
const cors = require('cors');
const path = require('path');
const CvDatabase = require('./lib/db');
const { tokenAuth } = require('./lib/auth');
const { buildHealth } = require('./lib/health');
const pkg = require('./package.json');

// Route modules
const createSettingsRouter = require('./routes/settings');
const createPersonsRouter = require('./routes/persons');
const createSectionsRouter = require('./routes/sections');
const createEntriesRouter = require('./routes/entries');
const createItemsRouter = require('./routes/items');
const createVariantsRouter = require('./routes/variants');
const createDataRouter = require('./routes/data');
const createLayoutsRouter = require('./routes/layouts');
const { seedBuiltinLayouts } = require('./lib/render/seed');

const app = express();
const PORT = process.env.PORT || 3001;
const PROJECT_ROOT = path.resolve(__dirname, '..');

const DB_PATH = process.env.CV_DB_PATH || path.join(PROJECT_ROOT, 'cv.db');
let db;

function getDb() {
  if (!db) {
    db = new CvDatabase(DB_PATH);
    seedBuiltinLayouts(db); // register builtin layout bundles + set default
  }
  return db;
}

// Allow tests to inject an in-memory DB.
app.setDb = function (testDb) { db = testDb; };
app.getDb = function () { return getDb(); };

// HTTP status -> stable machine code for the error envelope.
const STATUS_CODES = {
  400: 'bad_request', 401: 'unauthorized', 403: 'forbidden', 404: 'not_found',
  405: 'method_not_allowed', 409: 'conflict', 413: 'payload_too_large',
  415: 'unsupported_media_type', 422: 'unprocessable_entity', 429: 'rate_limited',
  500: 'internal_error',
};

// Build the GET /api discovery list by walking the Express 4 router stack:
// direct routes carry `.route`; mounted routers carry `.handle.stack` with a
// prefix encoded in `.regexp`.
function listEndpoints(expressApp) {
  const out = [];
  const seen = new Set();
  const prefixOf = (re) => {
    if (!re || re.fast_slash) return '';
    return re.source
      .replace(/^\^/, '')
      .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')
      .replace(/\\\//g, '/')
      .replace(/\$$/, '');
  };
  const walk = (stack, prefix) => {
    for (const layer of stack) {
      if (layer.route) {
        const p = (prefix + layer.route.path).replace(/\/{2,}/g, '/') || '/';
        for (const m of Object.keys(layer.route.methods || {})) {
          if (!layer.route.methods[m]) continue;
          const M = m.toUpperCase();
          if (M === 'HEAD') continue;
          const key = `${M} ${p}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ method: M, path: p, summary: '' });
        }
      } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
        walk(layer.handle.stack, prefix + prefixOf(layer.regexp));
      }
    }
  };
  walk(expressApp._router.stack, '');
  out.sort((a, b) => (a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path)));
  return out;
}

// CORS: any localhost/127.0.0.1 port + the production domain by default; extra
// exact origins may be added via CV_CORS_ORIGINS (comma-separated).
const CV_PROD_ORIGIN = process.env.CV_PROD_ORIGIN || 'https://andypeterson.dev';
const CV_EXTRA_ORIGINS = (process.env.CV_CORS_ORIGINS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);
const LOCALHOST_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
app.use(cors({
  origin(origin, cb) {
    // No Origin header (curl, same-origin, server-to-server) → allow.
    if (!origin) return cb(null, true);
    const ok = LOCALHOST_ORIGIN_RE.test(origin)
      || origin === CV_PROD_ORIGIN
      || CV_EXTRA_ORIGINS.includes(origin);
    return cb(null, ok);
  },
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Public contract routes (registered before auth): health + API discovery.
// ---------------------------------------------------------------------------

app.get('/health', (req, res) => {
  try {
    res.json(buildHealth(getDb));
  } catch (e) {
    res.status(500).json({ error: { code: 'internal_error', message: e.message } });
  }
});

app.get('/api', (req, res) => {
  res.json({
    service: 'cv',
    version: pkg.version,
    endpoints: listEndpoints(app),
    streaming: [],
  });
});

// Optional app-level auth on the API (defense in depth behind the reverse proxy).
// No-op unless CV_EDITOR_TOKEN is set, so local dev + tests stay unauthenticated.
app.use('/api', tokenAuth(process.env.CV_EDITOR_TOKEN));

// ---------------------------------------------------------------------------
// Mount routers — every content route is id-addressable; there is no active
// person / session state.
// ---------------------------------------------------------------------------

app.use('/api/settings', createSettingsRouter(getDb));     // global style/spacing/fonts
app.use('/api/persons', createPersonsRouter(getDb));       // persons + personal + sections/variants/tags scope
app.use('/api/sections', createSectionsRouter(getDb));     // section by id + its entries
app.use('/api/entries', createEntriesRouter(getDb));       // entry by id + its items + tags
app.use('/api/items', createItemsRouter(getDb));           // item by id + tags
app.use('/api/variants', createVariantsRouter(getDb, PROJECT_ROOT)); // variant by id + rules/sections/overrides/resolve/pdf
app.use('/api/layouts', createLayoutsRouter(getDb, PROJECT_ROOT)); // layout list/get/upload/verify/delete + default
app.use('/api', createDataRouter(getDb));                  // catalog + health

// ---------------------------------------------------------------------------
// Error handling middleware
// ---------------------------------------------------------------------------

// Unmatched route → JSON 404 envelope.
app.use((req, res) => {
  res.status(404).json({ error: { code: 'not_found', message: 'Not found' } });
});

// Uniform JSON error envelope: {error:{code,message,details?}}.
app.use((err, req, res, _next) => {
  const status = err.status || 500;
  const code = err.code || STATUS_CODES[status] || 'error';
  const body = { error: { code, message: err.message || 'Internal server error' } };
  if (err.details !== undefined) body.error.details = err.details;
  res.status(status).json(body);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

if (require.main === module) {
  app.listen(PORT, process.env.HOST || '127.0.0.1', () => {
    console.log(`CV Editor running at http://localhost:${PORT}`);
    console.log(`Project root: ${PROJECT_ROOT}`);
    console.log(`Database: ${DB_PATH}`);
  });
}

module.exports = app;
