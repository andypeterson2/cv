const express = require('express');
const cors = require('cors');
const path = require('path');
const CvDatabase = require('./lib/db');
const { tokenAuth } = require('./lib/auth');

// Route modules
const createSettingsRouter = require('./routes/settings');
const createPersonsRouter = require('./routes/persons');
const createSectionsRouter = require('./routes/sections');
const createEntriesRouter = require('./routes/entries');
const createItemsRouter = require('./routes/items');
const createVariantsRouter = require('./routes/variants');
const createDataRouter = require('./routes/data');

const app = express();
const PORT = process.env.PORT || 3000;
const PROJECT_ROOT = path.resolve(__dirname, '..');

const DB_PATH = process.env.CV_DB_PATH || path.join(PROJECT_ROOT, 'cv.db');
let db;

function getDb() {
  if (!db) db = new CvDatabase(DB_PATH);
  return db;
}

// Allow tests to inject an in-memory DB.
app.setDb = function (testDb) { db = testDb; };
app.getDb = function () { return getDb(); };

app.use(cors({
  origin: process.env.CV_CORS_ORIGINS
    ? process.env.CV_CORS_ORIGINS.split(',')
    : ['http://localhost:3001', 'http://127.0.0.1:3001', 'http://localhost:4322', 'http://127.0.0.1:4322', 'http://localhost:8000', 'http://127.0.0.1:8000', 'http://localhost:3000', 'http://127.0.0.1:3000'],
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

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
app.use('/api', createDataRouter(getDb));                  // catalog + health

// ---------------------------------------------------------------------------
// Error handling middleware
// ---------------------------------------------------------------------------

app.use((err, req, res, _next) => {
  const status = err.status || 500;
  const body = { error: err.message || 'Internal server error' };
  if (err.details) body.details = err.details;
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
