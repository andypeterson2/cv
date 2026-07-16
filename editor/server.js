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
// Behind the Cloudflare gateway → Railway the socket IP is the proxy's; trust one
// hop so req.ip is meaningful. Rate limits key on CF-Connecting-IP (see lib/client-ip).
app.set('trust proxy', 1);
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

// Explicit (prefix, router) mount table. GET /api discovery reports fully-qualified
// paths from this table instead of reverse-engineering Express's internal mount
// regexps — those changed in Express 5 (path-to-regexp v8) and broke the old
// hand-rolled router-stack walk. Order matters: the catch-all '/api' router is last.
const API_ROUTERS = [
  ['/api/settings', createSettingsRouter(getDb)],     // global style/spacing/fonts
  ['/api/persons', createPersonsRouter(getDb)],       // persons + personal + sections/variants/tags scope
  ['/api/sections', createSectionsRouter(getDb)],     // section by id + its entries
  ['/api/entries', createEntriesRouter(getDb)],       // entry by id + its items + tags
  ['/api/items', createItemsRouter(getDb)],           // item by id + tags
  ['/api/variants', createVariantsRouter(getDb, PROJECT_ROOT)], // variant by id + rules/sections/overrides/resolve/pdf
  ['/api/layouts', createLayoutsRouter(getDb, PROJECT_ROOT)],   // layout list/get/upload/verify/delete + default
  ['/api', createDataRouter(getDb)],                  // catalog + health
];

// HTTP status -> stable machine code for the error envelope.
const STATUS_CODES = {
  400: 'bad_request', 401: 'unauthorized', 403: 'forbidden', 404: 'not_found',
  405: 'method_not_allowed', 409: 'conflict', 413: 'payload_too_large',
  415: 'unsupported_media_type', 422: 'unprocessable_entity', 429: 'rate_limited',
  500: 'internal_error',
};

// Build the GET /api discovery list. Mounted routers are introspected via the
// explicit API_ROUTERS (prefix, router) table rather than reverse-engineering
// Express's internal mount regexps — those changed in Express 5 (path-to-regexp
// v8) and broke the old hand-rolled walk. Each router's route layers expose the
// stable `.route.path` / `.route.methods`, as do the app's own top-level routes.
function listEndpoints(expressApp) {
  const out = [];
  const seen = new Set();
  const add = (method, rawPath) => {
    const M = method.toUpperCase();
    if (M === 'HEAD') return;
    let p = rawPath.replace(/\/{2,}/g, '/');
    if (p.length > 1) p = p.replace(/\/$/, '');
    const key = `${M} ${p}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ method: M, path: p, summary: '' });
  };
  const addRouteLayer = (prefix, layer) => {
    if (!layer.route) return;
    for (const m of Object.keys(layer.route.methods || {})) {
      if (layer.route.methods[m]) add(m, prefix + layer.route.path);
    }
  };
  // Top-level routes registered directly on the app (e.g. /health, GET /api).
  const rootStack = (expressApp._router || expressApp.router || {}).stack || [];
  for (const layer of rootStack) addRouteLayer('', layer);
  // Mounted routers, with their prefixes supplied explicitly.
  for (const [prefix, router] of API_ROUTERS) {
    for (const layer of router.stack || []) addRouteLayer(prefix, layer);
  }
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
// API-only: the editor frontend is owned and served by the portal — no static serving.

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

// Optional app-level auth on the API (defense in depth; the backend is also
// directly reachable on its public URL, so this is the real gate). No-op unless
// CV_EDITOR_TOKEN is set, so local dev + tests stay unauthenticated. Public demo
// persons (e.g. the Jane Doe seed, id 1) stay readable unauthenticated; any other
// person's reads + all writes + the /pdf compile require the token.
app.use('/api', tokenAuth(process.env.CV_EDITOR_TOKEN, { publicPersonIds: process.env.CV_PUBLIC_PERSON_IDS || '1', getDb }));

// ---------------------------------------------------------------------------
// Mount routers — every content route is id-addressable; there is no active
// person / session state.
// ---------------------------------------------------------------------------

for (const [prefix, router] of API_ROUTERS) app.use(prefix, router);

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
