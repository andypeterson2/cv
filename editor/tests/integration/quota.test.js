/**
 * Per-account storage limits: a write from an account over its byte quota is
 * refused (deletes still work), profiles and saved versions have count caps, and
 * the site owner is not limited.
 */
process.env.CV_ACCOUNT_QUOTA_MB = '0.05'; // about 52 KB
process.env.CV_PROFILES_PER_ACCOUNT = '2';
process.env.CV_VERSIONS_PER_PROFILE = '2';

const http = require('http');
const CvDatabase = require('../../lib/db');

let server;
let port;
let db;
let user;

function request(method, urlPath, body, userId) {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const headers = {};
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    if (userId != null) headers['X-User-Id'] = String(userId);
    const req = http.request(
      { hostname: 'localhost', port, path: urlPath, method, headers },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

beforeAll(async () => {
  const app = require('../../server');
  db = new CvDatabase(':memory:');
  db.clearAllContent();
  app.setDb(db);
  user = db.upsertUser({ googleSub: 'sub-q', email: 'q@x.com', name: 'Q' });
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      port = server.address().port;
      resolve();
    });
  });
});

afterAll(async () => {
  if (server) await new Promise((r) => server.close(r));
});

test('profiles and saved versions stop at their caps', async () => {
  const a = await request('POST', '/api/profiles', { name: 'One' }, user);
  expect(a.status).toBe(201);
  expect((await request('POST', '/api/profiles', { name: 'Two' }, user)).status).toBe(201);
  const third = await request('POST', '/api/profiles', { name: 'Three' }, user);
  expect(third.status).toBe(413);
  expect(third.body.error.code).toBe('quota_exceeded');

  const pid = a.body.id;
  expect((await request('POST', `/api/profiles/${pid}/versions`, {}, user)).status).toBe(201);
  expect((await request('POST', `/api/profiles/${pid}/versions`, {}, user)).status).toBe(201);
  expect((await request('POST', `/api/profiles/${pid}/versions`, {}, user)).status).toBe(413);
});

test('writes stop at the byte quota, deletes still work, and usage reports it', async () => {
  const pid = db.getProfilesForUser(user)[0].id;
  const section = await request(
    'POST',
    `/api/profiles/${pid}/sections`,
    { slug: 'experience', type: 'experience', title: 'Experience' },
    user,
  );
  expect(section.status).toBe(201);
  const entry = await request(
    'POST',
    `/api/sections/${section.body.id}/entries`,
    { fields: {} },
    user,
  );
  expect(entry.status).toBe(201);
  const big = 'x'.repeat(20_000);
  const statuses = [];
  for (let i = 0; i < 5; i++) {
    const res = await request(
      'POST',
      `/api/entries/${entry.body.id}/items`,
      { content: big },
      user,
    );
    statuses.push(res.status);
  }
  expect(statuses).toContain(413);
  expect(statuses.indexOf(413)).toBeGreaterThan(0);

  const usage = await request('GET', '/api/usage', undefined, user);
  expect(usage.status).toBe(200);
  expect(usage.body.unlimited).toBe(false);
  expect(usage.body.bytes.used).toBeGreaterThan(usage.body.bytes.limit * 0.5);
  expect(usage.body.profiles).toEqual({ used: 2, limit: 2 });

  const del = await request('DELETE', `/api/sections/${section.body.id}`, undefined, user);
  expect(del.status).toBe(200);
});

test('the site owner is not limited', async () => {
  const owner = db.ownerUserId();
  for (const name of ['O1', 'O2', 'O3']) {
    expect((await request('POST', '/api/profiles', { name }, owner)).status).toBe(201);
  }
  expect((await request('GET', '/api/usage', undefined, owner)).body.unlimited).toBe(true);
});
