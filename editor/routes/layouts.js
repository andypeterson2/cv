const express = require('express');
const os = require('os');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const extract = require('extract-zip');
const { rateLimit } = require('express-rate-limit');
const { clientIp } = require('../lib/client-ip');
const { AppError, NotFoundError } = require('../lib/errors');
const wrap = require('../lib/async-handler');
const { verifyLayout, gatherSamples } = require('../lib/render/verify');
const { loadLayout } = require('../lib/render/loader');
const { bundleChecksum } = require('../lib/render/seed');
const { uploadedLayoutDir, layoutDirForRow, DEFAULT_LAYOUT_ID } = require('../lib/render/layouts');

// A bundle root is a dir containing layout.json — either the zip root, or a
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

function upsertFromManifest(db, manifest, { status, source, checksum, report }) {
  return db.upsertLayout({
    id: manifest.id,
    name: manifest.name || manifest.id,
    version: manifest.version,
    engine: manifest.engine,
    kinds: manifest.kinds,
    status,
    source,
    manifest,
    checksum,
    report,
    verified_at: new Date().toISOString(),
  });
}

/**
 * Layouts API. P3: upload (gated by the verification harness), on-demand
 * re-verify, and delete, plus the P1 list / get / global-default selection.
 */
module.exports = function createLayoutsRouter(getDb, projectRoot) {
  const router = express.Router();
  const ASSETS_DIR = path.join(projectRoot, 'assets');

  const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
  const uploadRateLimit = rateLimit({
    windowMs: 60 * 1000,
    max: Number(process.env.CV_UPLOAD_RATE_MAX) || 5,
    keyGenerator: clientIp,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'rate_limited', message: 'Too many layout uploads — please wait.' } },
  });

  router.get(
    '/',
    wrap((req, res) => {
      res.json({ layouts: getDb().listLayouts(), default: getDb().getDefaultLayoutId() });
    }),
  );

  router.get(
    '/default',
    wrap((req, res) => {
      res.json({ layout_id: getDb().getDefaultLayoutId() });
    }),
  );

  router.put(
    '/default',
    wrap((req, res) => {
      const id = req.body && req.body.layout_id;
      if (typeof id !== 'string' || !id) throw new AppError('layout_id is required', 400);
      const layout = getDb().getLayout(id);
      if (!layout) throw new NotFoundError('Layout not found');
      if (layout.status !== 'active') throw new AppError('Layout is not active', 409);
      getDb().setDefaultLayoutId(id);
      res.json({ success: true });
    }),
  );

  // Upload a .zip bundle → extract (zip-slip-safe) → verify → install or reject.
  // Nothing is installed unless the verification report passes.
  router.post(
    '/',
    uploadRateLimit,
    upload.single('bundle'),
    wrap(async (req, res) => {
      if (!req.file) throw new AppError('Expected a .zip bundle in form field "bundle"', 400);
      const work = fs.mkdtempSync(path.join(os.tmpdir(), 'layout-upload-'));
      try {
        try {
          await extract(req.file.path, { dir: work }); // extract-zip rejects path traversal
        } catch (e) {
          throw new AppError('Could not read the zip: ' + e.message, 400);
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

        const existing = getDb().getLayout(manifest.id);
        if (existing && existing.source === 'builtin') {
          throw new AppError(
            `"${manifest.id}" is the id of a builtin layout and cannot be overwritten`,
            409,
          );
        }

        const report = await verifyLayout(root, {
          assetsDir: ASSETS_DIR,
          samples: gatherSamples(getDb()),
        });
        if (!report.ok) {
          return res
            .status(422)
            .json({
              error: {
                code: 'verification_failed',
                message: 'Layout failed verification',
                details: report,
              },
            });
        }

        const dest = uploadedLayoutDir(manifest.id);
        fs.rmSync(dest, { recursive: true, force: true });
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.cpSync(root, dest, { recursive: true });

        const row = upsertFromManifest(getDb(), manifest, {
          status: 'active',
          source: 'upload',
          checksum: bundleChecksum(dest),
          report,
        });
        res.status(201).json({ success: true, layout: row, report });
      } finally {
        fs.rmSync(work, { recursive: true, force: true });
        fs.rmSync(req.file.path, { force: true });
      }
    }),
  );

  router.get(
    '/:id',
    wrap((req, res) => {
      const layout = getDb().getLayout(req.params.id);
      if (!layout) throw new NotFoundError('Layout not found');
      res.json(layout);
    }),
  );

  // Re-run the contract gate on an installed layout (e.g. after data changes).
  // A previously-active upload that now fails is marked invalid (→ falls back).
  router.post(
    '/:id/verify',
    wrap(async (req, res) => {
      const layout = getDb().getLayout(req.params.id);
      if (!layout) throw new NotFoundError('Layout not found');
      const report = await verifyLayout(layoutDirForRow(layout), {
        assetsDir: ASSETS_DIR,
        samples: gatherSamples(getDb()),
      });
      upsertFromManifest(
        getDb(),
        layout.manifest || {
          id: layout.id,
          name: layout.name,
          version: layout.version,
          engine: layout.engine,
          kinds: layout.kinds,
        },
        {
          status: report.ok ? 'active' : 'invalid',
          source: layout.source,
          checksum: layout.checksum,
          report,
        },
      );
      res.json({ ok: report.ok, report });
    }),
  );

  router.delete(
    '/:id',
    wrap((req, res) => {
      const layout = getDb().getLayout(req.params.id);
      if (!layout) throw new NotFoundError('Layout not found');
      if (layout.source === 'builtin') throw new AppError('Cannot delete a builtin layout', 409);
      fs.rmSync(uploadedLayoutDir(layout.id), { recursive: true, force: true });
      getDb().deleteLayout(layout.id); // also reverts referencing variants to NULL
      if (getDb().getDefaultLayoutId() === layout.id) getDb().setDefaultLayoutId(DEFAULT_LAYOUT_ID);
      res.json({ success: true });
    }),
  );

  return router;
};
