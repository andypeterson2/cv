#!/usr/bin/env node
/**
 * Polling dev watcher for the cv-editor.
 *
 * WHY THIS EXISTS: macOS Docker Desktop bind mounts do not deliver inotify
 * events into the Linux container, so `node --watch` (libuv fs.watch / inotify)
 * never sees host edits — editor code changes silently keep running stale until
 * a manual `docker restart`. `fs.watchFile` polls file mtimes via stat(), which
 * works over the bind mount because it reads metadata instead of waiting for
 * filesystem events.
 *
 * Wired via package.json "dev": "node dev-watch.cjs". Outside Docker (native
 * dev), `node --watch server.js` is fine; this is only needed for the container.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const EDITOR = __dirname;
const ROOTS = [EDITOR, path.join(EDITOR, '..', 'shared')];
const WATCH_EXTS = new Set(['.js', '.cjs', '.mjs', '.json']);
const IGNORE_DIRS = new Set(['node_modules', '.git', 'build', 'tests', 'coverage', 'public']);
const INTERVAL = 800; // ms between stat() polls

let child = null;
let timer = null;

function start() {
  child = spawn(process.execPath, ['server.js'], { stdio: 'inherit', cwd: EDITOR });
}

function scheduleRestart(file) {
  clearTimeout(timer); // debounce bursts of changes into one restart
  timer = setTimeout(() => {
    console.log(`[dev-watch] ${path.relative(EDITOR, file)} changed — restarting server.js`);
    const prev = child;
    child = null;
    if (prev) {
      prev.once('exit', start);
      prev.kill('SIGTERM');
    } else start();
  }, 150);
}

function collect(dir, acc) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || IGNORE_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) collect(full, acc);
    else if (WATCH_EXTS.has(path.extname(e.name))) acc.push(full);
  }
  return acc;
}

const files = [];
for (const r of ROOTS) collect(r, files);
for (const f of files) {
  fs.watchFile(f, { interval: INTERVAL }, (cur, prev) => {
    if (cur.mtimeMs !== prev.mtimeMs) scheduleRestart(f);
  });
}
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    if (child) child.kill(sig);
    process.exit(0);
  });
}

console.log(
  `[dev-watch] polling ${files.length} files every ${INTERVAL}ms (inotify-free hot reload for Docker-on-macOS)`,
);
start();
