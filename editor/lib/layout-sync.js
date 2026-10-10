/**
 * Layouts that come from public GitHub repositories: linking a repo, checking a
 * commit without installing it, and syncing a linked layout to the newest commit
 * on the release or branch it follows.
 *
 * A linked family keeps one mutable root row (`u<uid>-<slug>`) holding the newest
 * commit that passed verification; the author's own pins point at it, so they
 * follow every update. Once the author publishes, each new commit also becomes an
 * immutable version row (`<root>@<n>`) for other accounts to pin: pending for the
 * owner's review, or public straight away when the owner has trusted the family
 * and the version passes the same checks a review requires.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const github = require('./github');
const { AppError } = require('./errors');
const { readBundle, dirBytes, forgetZip } = require('./render/bundle');
const {
  verifyLayout,
  gatherSamples,
  publicReport,
  slowestCompile,
  summarizeReport,
} = require('./render/verify');
const { bundleChecksum } = require('./render/seed');
const { uploadedLayoutDir } = require('./render/layouts');
const { assertBelow, assertLayoutBytes } = require('./quota');

const DAY = 24 * 60 * 60 * 1000;
const MANUAL_SYNC_GAP_MS = 5 * 60 * 1000;
const MAX_COMPILE_MS = () => Number(process.env.CV_LAYOUT_MAX_COMPILE_MS) || 10000;

// The row id an upload is stored under. Two accounts may install the same manifest
// id, so the stored id carries the installer; the manifest keeps its own id as
// provenance. Treat the prefix as opaque: what a caller may reach is decided by the
// row's user_id, never by reading a number back out of this string.
function storedLayoutId(userId, manifestId) {
  return `u${userId}-${manifestId}`;
}

/** Why a version cannot go public yet, as sentences; empty when it can. */
function approvalProblems(layout) {
  const problems = [];
  const dir = uploadedLayoutDir(layout.id);
  if (!fs.existsSync(dir) || bundleChecksum(dir) !== layout.checksum)
    problems.push('the files changed since verification');
  const pdf = (layout.report?.checks || []).filter((c) => c.name.startsWith('pdf:'));
  if (pdf.length === 0 || pdf.some((c) => !c.ok || c.skipped))
    problems.push('the PDF safety scan did not pass on every fixture');
  if (layout.compileMs == null || layout.compileMs > MAX_COMPILE_MS())
    problems.push(`a fixture took longer than ${MAX_COMPILE_MS()} ms to compile`);
  return problems;
}

/** Download one commit and unpack the layout in `folder`; the caller removes `tmp`. */
async function fetchBundle(db, { owner, repo, folder, sha }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'layout-gh-'));
  try {
    const zip = await github.downloadZipball(owner, repo, sha, path.join(tmp, 'repo.zip'));
    const bundle = await readBundle(zip, db, { subdir: folder || '' });
    return { ...bundle, tmp };
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
}

function cleanup(bundle) {
  if (!bundle) return;
  fs.rmSync(bundle.work, { recursive: true, force: true });
  fs.rmSync(bundle.tmp, { recursive: true, force: true });
}

/** The default verification; tests pass their own as `verify`. */
function verifyFor(db, root, userId, assetsDir) {
  return verifyLayout(root, {
    assetsDir,
    samples: gatherSamples(db, { userId }),
    compileKey: userId,
  });
}

function rowFields(manifest) {
  return {
    name: manifest.name || manifest.id,
    version: manifest.version,
    engine: manifest.engine,
    kinds: manifest.kinds,
    manifest,
  };
}

/**
 * Install `root` as the caller's layout (replacing their earlier copy of the same
 * manifest id), within their storage quota. Returns the row.
 */
function installRoot(db, { root, manifest, userId, report, sourceSha = null, sourceRef = null }) {
  const id = storedLayoutId(userId, manifest.id);
  const existing = db.getLayout(id, userId);
  if (!existing) assertBelow(db, userId, 'layout');
  const bytes = dirBytes(root);
  assertLayoutBytes(db, userId, bytes, existing ? existing.bytes : 0);
  const dest = uploadedLayoutDir(id);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(root, dest, { recursive: true });
  const row = db.upsertLayout({
    id,
    ...rowFields(manifest),
    status: 'active',
    source: 'upload',
    checksum: bundleChecksum(dest),
    report: publicReport(report),
    verified_at: new Date().toISOString(),
    userId,
    bytes,
    sourceSha,
    sourceRef,
  });
  db.setLayoutReport(id, userId, report);
  if (existing && existing.checksum && existing.checksum !== row.checksum)
    forgetZip(existing.checksum, db.layoutChecksumInUse(existing.checksum));
  return row;
}

/**
 * Snapshot the family root as its next numbered version, in `state`. A version
 * still waiting for review is replaced by a newer one rather than queued behind it.
 */
function snapshotVersion(db, { rootRow, userId, report, state }) {
  // Numbered before the superseded version goes, so a number is never reused.
  const n = db.nextLayoutVersion(rootRow.family);
  for (const v of db.familyVersions(rootRow.family)) {
    if (v.state === 'pending' || v.state === 'rejected') {
      fs.rmSync(uploadedLayoutDir(v.id), { recursive: true, force: true });
      db.deleteLayoutUnscoped(v.id);
    }
  }
  if (state === 'pending') assertBelow(db, userId, 'pending');
  assertBelow(db, userId, 'layout');
  assertLayoutBytes(db, userId, rootRow.bytes || dirBytes(uploadedLayoutDir(rootRow.id)));
  const id = `${rootRow.id}@${n}`;
  const dest = uploadedLayoutDir(id);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(uploadedLayoutDir(rootRow.id), dest, { recursive: true });
  db.upsertLayout({
    id,
    ...rowFields(rootRow.manifest || { id: rootRow.family, kinds: rootRow.kinds }),
    status: 'active',
    source: 'upload',
    checksum: bundleChecksum(dest),
    report: publicReport(report),
    verified_at: new Date().toISOString(),
    userId,
    family: rootRow.family,
    versionNo: n,
    state,
    compileMs: slowestCompile(report),
    bytes: dirBytes(dest),
    sourceSha: rootRow.sourceSha,
    sourceRef: rootRow.sourceRef,
  });
  let row = db.getLayoutUnscoped(id);
  if (state === 'pending' && approvalProblems(row).length === 0 && isTrusted(db, rootRow.family)) {
    db.setLayoutState(id, 'public', { publishedAt: new Date().toISOString() });
    row = db.getLayoutUnscoped(id);
  }
  return row;
}

function isTrusted(db, family) {
  const src = db.getLayoutSource(family);
  return !!(src && src.trusted);
}

/**
 * Verify a repo at `ref` (a branch, tag or commit; the default branch when omitted)
 * without installing anything: {ok, missing, report, sha}.
 */
async function checkRepo(db, userId, { repo, folder, ref }, { assetsDir, verify = verifyFor }) {
  const { owner, repo: name } = github.parseRepo(repo);
  const { defaultBranch } = await github.getRepo(owner, name);
  const { sha } = await github.commitSha(owner, name, ref || defaultBranch);
  let bundle;
  try {
    bundle = await fetchBundle(db, { owner, repo: name, folder, sha });
    const report = await verify(db, bundle.root, userId, assetsDir);
    return { ok: report.ok, missing: summarizeReport(report, bundle.manifest), report, sha };
  } finally {
    cleanup(bundle);
  }
}

/**
 * Link a repo to the caller's layouts, installing its current commit. With
 * `layoutId`, relink (or adopt) that layout: the repo must hold the same manifest id,
 * so every pin of it stays meaningful. Throws AppError(422, {missing}) when the
 * commit fails verification; nothing changes then.
 */
async function linkSource(
  db,
  userId,
  { repo, folder, track, branch, layoutId },
  { assetsDir, verify = verifyFor },
) {
  const { owner, repo: name } = github.parseRepo(repo);
  if (!['release', 'branch'].includes(track))
    throw new AppError('track must be release or branch', 400);
  if (branch) github.assertRef(branch);
  const head = await github.resolveSource({ owner, repo: name, track, branch });
  let bundle;
  try {
    bundle = await fetchBundle(db, { owner, repo: name, folder, sha: head.sha });
    const id = storedLayoutId(userId, bundle.manifest.id);
    if (layoutId && layoutId !== id)
      throw new AppError(
        `That repository holds the layout "${bundle.manifest.id}", not this one; link it as a new layout instead`,
        409,
      );
    const current = db.getLayoutSource(id);
    if (!layoutId && current && (current.owner !== owner || current.repo !== name))
      throw new AppError(
        `This layout is already linked to ${current.owner}/${current.repo}; change its source instead`,
        409,
      );
    const report = await verify(db, bundle.root, userId, assetsDir);
    if (!report.ok) {
      const err = new AppError('Layout failed verification', 422);
      err.code = 'verification_failed';
      err.details = { report, missing: summarizeReport(report, bundle.manifest) };
      throw err;
    }
    const row = installRoot(db, {
      root: bundle.root,
      manifest: bundle.manifest,
      userId,
      report,
      sourceSha: head.sha,
      sourceRef: head.ref,
    });
    const moved =
      current &&
      (current.owner !== owner || current.repo !== name || current.path !== (folder || ''));
    db.upsertLayoutSource({
      family: id,
      userId,
      owner,
      repo: name,
      path: folder || '',
      track,
      branch: track === 'branch' ? branch || null : null,
      lastSha: head.sha,
      lastRef: head.ref,
      etag: head.etag,
      lastCheckedAt: new Date().toISOString(),
      lastError: null,
    });
    // A new repository has to earn the owner's trust again.
    if (moved) db.setLayoutSourceFlags(id, { trusted: false });
    if (current && current.shared) {
      snapshotVersion(db, { rootRow: db.getLayoutUnscoped(id), userId, report, state: 'pending' });
    }
    return { row, missing: summarizeReport(report, bundle.manifest) };
  } finally {
    cleanup(bundle);
  }
}

/**
 * Bring one linked family up to date with its repo. Never throws: a failure is
 * recorded on the source and the layout stays on its last good commit.
 * @returns {Promise<{changed: boolean, error?: string, version?: string}>}
 */
async function syncFamily(db, family, { assetsDir, verify = verifyFor }) {
  const src = db.getLayoutSource(family);
  if (!src) return { changed: false, error: 'not linked' };
  let bundle;
  try {
    const head = await github.resolveSource({
      owner: src.owner,
      repo: src.repo,
      track: src.track,
      branch: src.branch,
      etag: src.lastSha ? src.etag : null,
    });
    if (head.notModified || head.sha === src.lastSha) {
      db.recordLayoutSourceCheck(family, { etag: head.etag });
      return { changed: false };
    }
    const root = db.getLayoutUnscoped(family);
    bundle = await fetchBundle(db, {
      owner: src.owner,
      repo: src.repo,
      folder: src.path,
      sha: head.sha,
    });
    if (root && root.manifest && bundle.manifest.id !== root.manifest.id)
      throw new AppError(
        `${head.ref} holds the layout "${bundle.manifest.id}", not "${root.manifest.id}"`,
        409,
      );
    const report = await verify(db, bundle.root, src.userId, assetsDir);
    if (!report.ok) {
      const missing = summarizeReport(report, bundle.manifest);
      const error = `${head.ref} (${head.sha.slice(0, 7)}) failed: ${missing.slice(0, 3).join('; ')}`;
      db.recordLayoutSourceCheck(family, { error, etag: head.etag });
      return { changed: false, error };
    }
    installRoot(db, {
      root: bundle.root,
      manifest: bundle.manifest,
      userId: src.userId,
      report,
      sourceSha: head.sha,
      sourceRef: head.ref,
    });
    let version;
    if (src.shared) {
      const v = snapshotVersion(db, {
        rootRow: db.getLayoutUnscoped(family),
        userId: src.userId,
        report,
        state: 'pending',
      });
      version = v.id;
    }
    db.recordLayoutSourceCheck(family, { sha: head.sha, ref: head.ref, etag: head.etag });
    return { changed: true, version };
  } catch (e) {
    db.recordLayoutSourceCheck(family, { error: e.message });
    return { changed: false, error: e.message };
  } finally {
    cleanup(bundle);
  }
}

/**
 * A manual "check now" for one family, at most once per MANUAL_SYNC_GAP_MS per
 * family whoever asks, so the button cannot be used to hammer GitHub.
 */
async function syncNow(db, family, { assetsDir, verify, now = Date.now() }) {
  const src = db.getLayoutSource(family);
  if (!src) throw new AppError('This layout is not linked to a repository', 409);
  if (src.manualSyncedAt && now - src.manualSyncedAt < MANUAL_SYNC_GAP_MS) {
    const wait = Math.ceil((MANUAL_SYNC_GAP_MS - (now - src.manualSyncedAt)) / 60000);
    throw new AppError(`Checked a moment ago; try again in ${wait} min`, 429);
  }
  db.markLayoutSourceManualSync(family, now);
  return syncFamily(db, family, { assetsDir, verify });
}

/** Sync every linked family now, then daily, starting at a random point in the next hour. */
function scheduleLayoutSync(getDb, { assetsDir }) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    let changed = 0;
    try {
      for (const src of getDb().listLayoutSources()) {
        const r = await syncFamily(getDb(), src.family, { assetsDir });
        if (r.changed) changed++;
      }
      if (changed) console.log(`Layout sync: ${changed} layout(s) updated from GitHub.`);
    } catch (err) {
      console.error('Layout sync failed:', err.message);
    } finally {
      running = false;
    }
  };
  setTimeout(
    () => {
      void run();
      setInterval(() => void run(), DAY).unref();
    },
    Math.floor(Math.random() * 60 * 60 * 1000),
  ).unref();
}

module.exports = {
  storedLayoutId,
  approvalProblems,
  installRoot,
  snapshotVersion,
  checkRepo,
  linkSource,
  syncFamily,
  syncNow,
  scheduleLayoutSync,
  MANUAL_SYNC_GAP_MS,
};
