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
const {
  verifyLayout,
  gatherSamples,
  publicReport,
  slowestCompile,
} = require('../lib/render/verify');
const { pinCheck } = require('../lib/render/pin-check');
const { loadLayout, assertNoSymlinks } = require('../lib/render/loader');
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

// What a caller sees of a layout row: never another account's user id.
function present(layout, userId) {
  if (!layout) return layout;
  const { userId: owner, ...rest } = layout;
  return { ...rest, own: owner != null && owner === userId };
}

// The fixture compile limit a version must meet before the owner can approve it.
const MAX_COMPILE_MS = () => Number(process.env.CV_LAYOUT_MAX_COMPILE_MS) || 10000;

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
  const isOwner = (req) => req.userId != null && req.userId === getDb().ownerUserId();
  const requireOwner = (req) => {
    if (!isOwner(req)) throw new AppError('Only the site owner can review layouts', 403);
  };
  // A layout the caller may newly pin, or a 404/409 explaining why not.
  const pinnable = (id, userId, kind = null) => {
    const layout = getDb().getLayout(id, userId);
    if (!layout || !getDb().canPinLayout(layout, userId))
      throw new NotFoundError('Layout not found');
    if (layout.status !== 'active') throw new AppError('Layout is not active', 409);
    if (kind && Array.isArray(layout.kinds) && !layout.kinds.includes(kind))
      throw new AppError(`Layout does not support ${kind}`, 409);
    return layout;
  };
  // Keep the caller's full report to themselves; the row keeps the fixture part.
  const recordReport = (id, userId, report) => {
    if (userId != null) getDb().setLayoutReport(id, userId, report);
  };

  router.get(
    '/',
    wrap((req, res) => {
      res.json({
        layouts: getDb()
          .listLayouts(req.userId)
          .map((l) => present(l, req.userId)),
        default: defaultFor(req.userId),
        canReview: isOwner(req),
      });
    }),
  );

  // The owner's review queue. Registered before '/:id' so it is not read as an id.
  router.get(
    '/review',
    wrap((req, res) => {
      requireOwner(req);
      const pending = getDb()
        .listPendingLayouts()
        .map((l) => {
          const review = (l.report?.checks || []).find((c) => c.name === 'security:review');
          return { ...present(l, req.userId), report: l.report, warnings: review?.warnings || [] };
        });
      res.json({ pending, maxCompileMs: MAX_COMPILE_MS() });
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
    wrap(async (req, res) => {
      const id = req.body && req.body.layout_id;
      if (typeof id !== 'string' || !id) throw new AppError('layout_id is required', 400);
      const layout = pinnable(id, req.userId);
      const warnings = await pinCheck(getDb(), layout, req.userId, { assetsDir: ASSETS_DIR });
      getDb().setDefaultLayoutId(id, req.userId);
      res.json({ success: true, warnings });
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
        // extract-zip creates symlink entries from the archive; refuse the upload
        // before the manifest, the security scan or the install touch the tree.
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
          compileKey: req.userId,
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
          report: publicReport(report),
          userId: req.userId,
        });
        recordReport(storedId, req.userId, report);
        res.status(201).json({ success: true, layout: present(row, req.userId), report });
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
      const mine = getDb().getLayoutReport(layout.id, req.userId);
      res.json({ ...present(layout, req.userId), myReport: mine ? mine.report : null });
    }),
  );

  // Re-run the contract gate on an installed layout (e.g. after data changes).
  // A previously-active upload that now fails is marked invalid (→ falls back). Only
  // the uploader's own row changes status: a builtin, or anyone else's layout, is
  // shared, so one account's result must not switch it off for everybody.
  router.post(
    '/:id/verify',
    wrap(async (req, res) => {
      const layout = getDb().getLayout(req.params.id, req.userId);
      if (!layout) throw new NotFoundError('Layout not found');
      const report = await verifyLayout(layoutDirForRow(layout), {
        assetsDir: ASSETS_DIR,
        samples: gatherSamples(getDb(), { userId: req.userId }),
        compileKey: req.userId,
      });
      recordReport(layout.id, req.userId, report);
      if (layout.source === 'builtin' || layout.userId !== req.userId) {
        return res.json({ ok: report.ok, report });
      }
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
          report: publicReport(report),
          userId: layout.userId,
        },
      );
      res.json({ ok: report.ok, report });
    }),
  );

  // Publish one of the caller's uploads: snapshot it as the next version of its
  // family, verify the snapshot on fixtures only, and queue it for the owner.
  router.post(
    '/:id/publish',
    wrap(async (req, res) => {
      const layout = getDb().getLayout(req.params.id, req.userId);
      if (!layout || layout.userId !== req.userId) throw new NotFoundError('Layout not found');
      if (layout.versionNo != null) throw new AppError('Publish the upload, not a version', 409);
      if (layout.status !== 'active') throw new AppError('Layout is not active', 409);
      const n = getDb().nextLayoutVersion(layout.family);
      const id = `${layout.id}@${n}`;
      const dest = uploadedLayoutDir(id);
      fs.rmSync(dest, { recursive: true, force: true });
      fs.cpSync(uploadedLayoutDir(layout.id), dest, { recursive: true });
      const report = await verifyLayout(dest, {
        assetsDir: ASSETS_DIR,
        compileKey: req.userId,
      });
      if (!report.ok) {
        fs.rmSync(dest, { recursive: true, force: true });
        return res.status(422).json({
          error: {
            code: 'verification_failed',
            message: 'Layout failed verification',
            details: report,
          },
        });
      }
      const manifest = layout.manifest || { id: layout.family, kinds: layout.kinds };
      getDb().upsertLayout({
        id,
        name: manifest.name || layout.name,
        version: manifest.version,
        engine: manifest.engine,
        kinds: manifest.kinds,
        status: 'active',
        source: 'upload',
        manifest,
        checksum: bundleChecksum(dest),
        report,
        verified_at: new Date().toISOString(),
        userId: req.userId,
        family: layout.family,
        versionNo: n,
        state: 'pending',
        compileMs: slowestCompile(report),
      });
      res
        .status(201)
        .json({ success: true, layout: present(getDb().getLayout(id, req.userId), req.userId) });
    }),
  );

  // Withdraw a version: it leaves the listings, and anyone already using it keeps it.
  router.post(
    '/:id/unpublish',
    wrap((req, res) => {
      const layout = getDb().getLayout(req.params.id, req.userId);
      if (!layout || layout.userId !== req.userId) throw new NotFoundError('Layout not found');
      if (!['public', 'pending'].includes(layout.state))
        throw new AppError('Only a public or pending version can be unpublished', 409);
      getDb().setLayoutState(layout.id, 'unlisted');
      res.json({ success: true });
    }),
  );

  // The owner's decision on a pending version. Approval re-checks that the files on
  // disk are the ones verified, that every fixture PDF passed the safety scan (a
  // skipped scan does not count), and that the fixtures compiled fast enough.
  router.post(
    '/:id/review',
    wrap((req, res) => {
      requireOwner(req);
      const decision = req.body && req.body.decision;
      const note = (req.body && typeof req.body.note === 'string' && req.body.note) || null;
      if (!['approve', 'reject'].includes(decision))
        throw new AppError('decision must be approve or reject', 400);
      const layout = getDb().getLayoutUnscoped(req.params.id);
      if (!layout || layout.state !== 'pending')
        throw new NotFoundError('No pending layout with that id');
      if (decision === 'reject') {
        getDb().setLayoutState(layout.id, 'rejected', { note });
        return res.json({ success: true, state: 'rejected' });
      }
      const problems = [];
      const dir = uploadedLayoutDir(layout.id);
      if (!fs.existsSync(dir) || bundleChecksum(dir) !== layout.checksum)
        problems.push('the files changed since verification');
      const pdf = (layout.report?.checks || []).filter((c) => c.name.startsWith('pdf:'));
      if (pdf.length === 0 || pdf.some((c) => !c.ok || c.skipped))
        problems.push('the PDF safety scan did not pass on every fixture');
      if (layout.compileMs == null || layout.compileMs > MAX_COMPILE_MS())
        problems.push(`a fixture took longer than ${MAX_COMPILE_MS()} ms to compile`);
      if (problems.length) throw new AppError(`Cannot approve: ${problems.join('; ')}`, 409);
      getDb().setLayoutState(layout.id, 'public', { note, publishedAt: new Date().toISOString() });
      res.json({ success: true, state: 'public' });
    }),
  );

  router.delete(
    '/:id',
    wrap((req, res) => {
      const layout = getDb().getLayout(req.params.id, req.userId);
      if (!layout) throw new NotFoundError('Layout not found');
      if (layout.source === 'builtin') throw new AppError('Cannot delete a builtin layout', 409);
      if (layout.userId !== req.userId) throw new NotFoundError('Layout not found');
      // A version others may have pinned is withdrawn, not removed.
      if (layout.versionNo != null && ['public', 'unlisted'].includes(layout.state)) {
        getDb().setLayoutState(layout.id, 'unlisted');
        return res.json({ success: true, unlisted: true });
      }
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
