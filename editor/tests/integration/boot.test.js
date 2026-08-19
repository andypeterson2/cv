/**
 * Server boot — eager DB init (tech-debt: fail-fast on a broken migration).
 *
 * getDb() is lazy and /health is DB-free, so a migration that crashes would leave
 * the deploy health-check GREEN while every data request 500s on a half-applied
 * schema. server.js now initializes the DB (runs migrations) at boot, before it
 * listens, and exits non-zero on failure — turning that into a clean failed deploy.
 * These spawn the real server process to prove both halves of that guard.
 */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const SERVER = path.join(__dirname, '..', '..', 'server.js');

/** Boot server.js as its own process (so `require.main === module` runs). */
function boot(env, { killOnListen = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SERVER], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => {
      out += d;
      if (killOnListen && /running at/i.test(out)) child.kill(); // came up → stop it
    });
    child.stderr.on('data', (d) => {
      err += d;
    });
    child.on('exit', (code, signal) => resolve({ code, signal, out, err }));
  });
}

describe('server boot — eager DB init', () => {
  test('a DB that cannot be opened exits non-zero BEFORE listening', async () => {
    // Parent dir does not exist → better-sqlite3 can't open the file → init throws.
    const { code, out, err } = await boot({ CV_DB_PATH: '/nonexistent-cv-boot-dir/cv.db', PORT: '0' });
    expect(code).toBe(1);
    expect(err).toMatch(/FATAL: database initialization failed/i);
    expect(out).not.toMatch(/running at/i); // the port was never opened
  }, 20000);

  test('a valid DB runs migrations first, THEN listens', async () => {
    const tmp = path.join(os.tmpdir(), `cv-boot-${process.pid}-${Date.now()}.db`);
    try {
      const { out, signal } = await boot({ CV_DB_PATH: tmp, PORT: '0' }, { killOnListen: true });
      expect(out).toMatch(/Database initialized/i);
      expect(out).toMatch(/running at/i);
      // "Database initialized" is logged before "running at" — init precedes listen.
      expect(out.indexOf('Database initialized')).toBeLessThan(out.indexOf('running at'));
      expect(signal).toBe('SIGTERM'); // we killed it once it was up (a clean boot)
    } finally {
      fs.rmSync(tmp, { force: true });
      fs.rmSync(`${tmp}-wal`, { force: true });
      fs.rmSync(`${tmp}-shm`, { force: true });
    }
  }, 20000);
});
