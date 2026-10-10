/**
 * Removes compile leftovers. A compile builds in its own temp directory under
 * `build/` and deletes it when the PDF is sent, but a crash or restart mid-compile
 * leaves it behind, and the per-variant parent directories are never removed. The
 * sweep deletes anything older than `maxAgeMs`; compiles time out long before that,
 * so a live build directory is never touched. It also drops half-written zip cache
 * files the same age.
 */
const fs = require('fs');
const path = require('path');

const HOUR = 60 * 60 * 1000;

function olderThan(full, cutoff) {
  try {
    return fs.lstatSync(full).mtimeMs < cutoff;
  } catch {
    return false;
  }
}

/** Sweep `root` (build/), whose layout is build/<kind>/<id>/<temp dir>. */
function sweepBuildDir(root, { maxAgeMs = HOUR, now = Date.now() } = {}) {
  const cutoff = now - maxAgeMs;
  let removed = 0;
  const walk = (dir, depth) => {
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const full = path.join(dir, name);
      const isDir = fs.lstatSync(full).isDirectory();
      if (isDir && depth < 2) {
        // Judge the parent's age before its children go: removing them updates it.
        const old = olderThan(full, cutoff);
        walk(full, depth + 1);
        if (old && fs.readdirSync(full).length === 0) {
          fs.rmdirSync(full);
          removed++;
        }
      } else if (olderThan(full, cutoff)) {
        fs.rmSync(full, { recursive: true, force: true });
        removed++;
      }
    }
  };
  walk(root, 0);
  return removed;
}

/** Drop `*.tmp` files a crashed zip build left in the cache directory. */
function sweepZipCache(cacheDir, { maxAgeMs = HOUR, now = Date.now() } = {}) {
  let removed = 0;
  let names;
  try {
    names = fs.readdirSync(cacheDir);
  } catch {
    return 0;
  }
  for (const name of names) {
    const full = path.join(cacheDir, name);
    if (name.endsWith('.tmp') && olderThan(full, now - maxAgeMs)) {
      fs.rmSync(full, { force: true });
      removed++;
    }
  }
  return removed;
}

/** Sweep now and then every hour; the timer does not keep the process alive. */
function scheduleSweeps({ buildDir, zipCacheDir }) {
  const run = () => {
    try {
      const n = sweepBuildDir(buildDir) + sweepZipCache(zipCacheDir);
      if (n) console.log(`Removed ${n} stale build file(s).`);
    } catch (err) {
      console.error('Build sweep failed:', err.message);
    }
  };
  run();
  setInterval(run, HOUR).unref();
}

module.exports = { sweepBuildDir, sweepZipCache, scheduleSweeps };
