#!/usr/bin/env node
/**
 * CI harness for the MCP smoke test.
 *
 * Starts the cv-editor REST API on an ephemeral port backed by a throwaway temp
 * database, waits for /api/health, runs smoke-test.mjs against it, then tears
 * everything down. This makes `npm run test:smoke` a self-contained end-to-end
 * check of the MCP server — no manual "start the editor first" step.
 *
 * Requires the editor's dependencies to be installed (../editor/node_modules).
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';

const here = dirname(fileURLToPath(import.meta.url));
const editorEntry = join(here, '..', 'editor', 'server.js');

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForHealth(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // editor not up yet — retry
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const tmp = mkdtempSync(join(tmpdir(), 'cv-smoke-'));
const dbPath = join(tmp, 'cv.db');
const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;

const editor = spawn(process.execPath, [editorEntry], {
  stdio: ['ignore', 'inherit', 'inherit'],
  env: {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    CV_DB_PATH: dbPath,
    CV_EMBED_OFFLINE: '1', // never reach out for embedding models in CI
  },
});

let code = 1;
try {
  if (!(await waitForHealth(`${baseUrl}/api/health`))) {
    throw new Error(`cv-editor did not become healthy at ${baseUrl}`);
  }
  code = await new Promise((resolve) => {
    const smoke = spawn(process.execPath, [join(here, 'smoke-test.mjs')], {
      stdio: 'inherit',
      env: { ...process.env, CV_EDITOR_URL: baseUrl },
    });
    smoke.on('exit', (c) => resolve(c ?? 1));
  });
} catch (err) {
  console.error(err.message);
} finally {
  editor.kill('SIGTERM');
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
}
process.exit(code);
