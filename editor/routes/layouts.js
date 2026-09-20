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
const { SLUG_PATTERN } = require('@cv/constants');

const SLUG_RE = new RegExp(SLUG_PATTERN);

// The row id an upload is stored under. Two accounts may install the same manifest
// id, so the stored id carries the installer; the manifest keeps its own id as
// provenance. Treat the prefix as opaque: what a caller may reach is decided by the
// row's user_id, never by reading a number back out of this string.
function storedLayoutId(userId, manifestId) {
  return `u${userId}-${manifestId}`;
}

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

function upsertFromManifest(db, manifest, { id, status, source, checksum, report, userId }) {
  return db.upsertLayout({
    id,
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
    userId,
  });
}

/**
 * Layouts API: upload (gated by the verification harness), on-demand re-verify,
 * and delete, plus list / get / default selection.
 *
 * Every route is scoped to `req.userId`. An account sees the builtins plus its own
 * uploads, and an id belonging to someone else reads as missing.
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

  // An account with no default of its own reports the builtin, which is what the
  // selector would pick for it anyway.
  const defaultFor = (userId) => getDb().getDefaultLayoutId(userId) ?? DEFAULT_LAYOUT_ID;

  router.get(
    '/',
    wrap((req, res) => {
      res.json({ layouts: getDb().listLayouts(req.userId), default: defaultFor(req.userId) });
    }),
  );

  router.get(
    '/default',
    wrap((req, res) => {
      res.json({ layout_id: defaultFor(req.userId) });
    }),
  );

  router.put(
    '/default',
    wrap((req, res) => {
      const id = req.body && req.body.layout_id;
      if (typeof id !== 'string' || !id) throw new AppError('layout_id is required', 400);
      const layout = getDb().getLayout(id, req.userId);
      if (!layout) throw new NotFoundError('Layout not found');
      if (layout.status !== 'active') throw new AppError('Layout is not active', 409);
      getDb().setDefaultLayoutId(id, req.userId);
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

        // The id names a directory under CV_LAYOUTS_DIR, so it has to be a slug
        // before anything derives a path from it.
        if (typeof manifest.id !== 'string' || !SLUG_RE.test(manifest.id)) {
          throw new AppError(`Manifest id must match ${SLUG_PATTERN}`, 422);
        }

        // Builtins own their bare ids for everyone; an upload may not shadow one.
        const builtin = getDb().getLayout(manifest.id, null);
        if (builtin && builtin.source === 'builtin') {
          throw new AppError(
            `"${manifest.id}" is the id of a builtin layout and cannot be overwritten`,
            409,
          );
        }

        const storedId = storedLayoutId(req.userId, manifest.id);
        const report = await verifyLayout(root, {
          assetsDir: ASSETS_DIR,
          samples: gatherSamples(getDb(), { userId: req.userId }),
        });
        if (!report.ok) {
          return res.status(422).json({
            error: {
              code: 'verification_failed',
              message: 'Layout failed verification',
              details: report,
            },
          });
        }

        const dest = uploadedLayoutDir(storedId);
        fs.rmSync(dest, { recursive: true, force: true });
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.cpSync(root, dest, { recursive: true });

        const row = upsertFromManifest(getDb(), manifest, {
          id: storedId,
          status: 'active',
          source: 'upload',
          checksum: bundleChecksum(dest),
          report,
          userId: req.userId,
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
      const layout = getDb().getLayout(req.params.id, req.userId);
      if (!layout) throw new NotFoundError('Layout not found');
      res.json(layout);
    }),
  );

  // Re-run the contract gate on an installed layout (e.g. after data changes).
  // A previously-active upload that now fails is marked invalid (→ falls back).
  router.post(
    '/:id/verify',
    wrap(async (req, res) => {
      const layout = getDb().getLayout(req.params.id, req.userId);
      if (!layout) throw new NotFoundError('Layout not found');
      const report = await verifyLayout(layoutDirForRow(layout), {
        assetsDir: ASSETS_DIR,
        samples: gatherSamples(getDb(), { userId: req.userId }),
      });
      // Re-upsert under the row's own id and owner. The manifest carries the bare
      // id it was authored with, so upserting by that would insert a second row.
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
          id: layout.id,
          status: report.ok ? 'active' : 'invalid',
          source: layout.source,
          checksum: layout.checksum,
          report,
          userId: layout.userId,
        },
      );
      res.json({ ok: report.ok, report });
    }),
  );

  router.delete(
    '/:id',
    wrap((req, res) => {
      const layout = getDb().getLayout(req.params.id, req.userId);
      if (!layout) throw new NotFoundError('Layout not found');
      if (layout.source === 'builtin') throw new AppError('Cannot delete a builtin layout', 409);
      fs.rmSync(uploadedLayoutDir(layout.id), { recursive: true, force: true });
      getDb().deleteLayout(layout.id, req.userId); // also reverts referencing variants to NULL
      if (getDb().getDefaultLayoutId(req.userId) === layout.id) {
        getDb().setDefaultLayoutId(DEFAULT_LAYOUT_ID, req.userId);
      }
      res.json({ success: true });
    }),
  );

  return router;
};
