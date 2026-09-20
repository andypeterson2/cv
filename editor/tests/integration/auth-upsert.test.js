/**
 * Front-door user provisioning under a rotating origin secret.
 *
 * CV_ORIGIN_SECRET holds a comma-separated SET so senders can move across one at a
 * time. POST /api/auth/upsert-user mints users and is reachable only behind that
 * secret, so it has to accept every member of the set — a sender still on the old
 * value and one already on the new value both provision users.
 *
 * The origin guard stays soft here (CV_ORIGIN_SECRET_ENFORCE unset), so a request
 * reaches the router and the router's own check is what answers.
 */
process.env.CV_ORIGIN_SECRET = 'old-secret,new-secret';
delete process.env.CV_ORIGIN_SECRET_ENFORCE;

const http = require('http');
const CvDatabase = require('../../lib/db');

let server;
let port;
let db;

function upsert(secret, googleSub) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ googleSub, email: `${googleSub}@example.test` });
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    };
    if (secret != null) headers['X-Origin-Secret'] = secret;
    const req = http.request(
      { hostname: '127.0.0.1', port, path: '/api/auth/upsert-user', method: 'POST', headers },
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
    req.write(payload);
    req.end();
  });
}

beforeAll(async () => {
  const app = require('../../server');
  db = new CvDatabase(':memory:');
  app.setDb(db);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  port = server.address().port;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
});

describe('POST /api/auth/upsert-user — rotating origin secret', () => {
  test('a sender still on the old value provisions a user', async () => {
    const res = await upsert('old-secret', 'g-old');
    expect(res.status).toBe(200);
    expect(typeof res.body.userId).toBe('number');
  });

  test('a sender already on the new value provisions a user', async () => {
    const res = await upsert('new-secret', 'g-new');
    expect(res.status).toBe(200);
    expect(typeof res.body.userId).toBe('number');
  });

  test('the two senders get distinct accounts', async () => {
    const a = await upsert('old-secret', 'g-old');
    const b = await upsert('new-secret', 'g-new');
    expect(a.body.userId).not.toBe(b.body.userId);
  });

  test('the raw comma-joined value is not itself a secret', async () => {
    const res = await upsert('old-secret,new-secret', 'g-joined');
    expect(res.status).toBe(403);
  });

  test('a value outside the set is refused', async () => {
    expect((await upsert('gone-secret', 'g-gone')).status).toBe(403);
  });

  test('no secret at all is refused', async () => {
    expect((await upsert(null, 'g-none')).status).toBe(403);
  });
});
