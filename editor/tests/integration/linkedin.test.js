/**
 * Integration tests for the LinkedIn export/drift endpoints:
 * GET /persons/:pid/linkedin(/status) and POST /persons/:pid/linkedin/mark-synced.
 * In-memory DB, tokenAuth disabled (no CV_EDITOR_TOKEN) — covers routing, the
 * default-variant pick, format selection, and the export→mark→drift round-trip over
 * HTTP. The auth gating for these person-scoped routes is covered by auth.test.js.
 */
const http = require('http');
const CvDatabase = require('../../lib/db');

let server;
let port;
let db;

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: 'localhost',
        port,
        path: urlPath,
        method,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : {},
      },
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
  app.setDb(db);
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

let pid;
let entryA;
let entryB;
let vid;
beforeEach(() => {
  db.clearAllContent();
  pid = db.createPerson('Test');
  const sec = db.createSection(pid, 'experience', 'experience', 'Experience');
  entryA = db.createEntry(sec, { position: 'Engineer', organization: 'Acme', location: 'NYC', date: 'January 2020 -- March 2022' });
  db.createItem(entryA, 'Shipped the thing', '');
  entryB = db.createEntry(sec, { position: 'Intern', organization: 'Globex', location: 'Remote', date: 'June 2019 -- August 2019' });
  db.createItem(entryB, 'Learned the ropes', '');
  vid = db.createVariant(pid, 'CV', 'cv');
});

const stateById = (positions) => Object.fromEntries(positions.map((p) => [p.entryId, p.state]));
const experienceItem0 = () => db.getMain(pid).sections.find((s) => s.type === 'experience').entries.find((e) => e.id === entryA).items[0];

describe('LinkedIn endpoints', () => {
  test('GET /linkedin exports the cv variant by default — cleaned, bulleted, fingerprinted', async () => {
    const res = await request('GET', `/api/persons/${pid}/linkedin`);
    expect(res.status).toBe(200);
    expect(res.body.variantId).toBe(vid); // default = the person's cv-kind variant
    expect(res.body.format).toBe('linkedin');
    expect(res.body.positions).toHaveLength(2);
    expect(res.body.positions[0]).toMatchObject({ entryId: entryA, title: 'Engineer', company: 'Acme', location: 'NYC' });
    expect(res.body.positions[0].start).toEqual({ month: 1, year: 2020 });
    expect(res.body.positions[0].description.startsWith('• ')).toBe(true);
    expect(typeof res.body.positions[0].fingerprint).toBe('string');
  });

  test('explicit variant + format are honored; a variant not owned by the person → 404', async () => {
    const md = await request('GET', `/api/persons/${pid}/linkedin?variant=${vid}&format=markdown`);
    expect(md.status).toBe(200);
    expect(md.body.positions[0].description.startsWith('- ')).toBe(true);

    const bad = await request('GET', `/api/persons/${pid}/linkedin?variant=999999`);
    expect(bad.status).toBe(404);
  });

  test('status starts new; mark-synced flips it to synced', async () => {
    const before = await request('GET', `/api/persons/${pid}/linkedin/status`);
    expect(before.body.positions.map((p) => p.state)).toEqual(['new', 'new']);

    const mark = await request('POST', `/api/persons/${pid}/linkedin/mark-synced`, {});
    expect(mark.status).toBe(200);
    expect(mark.body.marked).toBe(2);

    const after = await request('GET', `/api/persons/${pid}/linkedin/status`);
    expect(after.body.positions.map((p) => p.state)).toEqual(['synced', 'synced']);
  });

  test('editing one entry drifts only it; a subset mark-synced re-stamps only the named entries', async () => {
    await request('POST', `/api/persons/${pid}/linkedin/mark-synced`, {}); // sync both
    db.updateItem(experienceItem0().id, { content: 'Shipped it faster' });

    const drift = await request('GET', `/api/persons/${pid}/linkedin/status`);
    const by = stateById(drift.body.positions);
    expect(by[entryA]).toBe('drifted');
    expect(by[entryB]).toBe('synced');

    const mark = await request('POST', `/api/persons/${pid}/linkedin/mark-synced`, { entryIds: [entryA] });
    expect(mark.body.marked).toBe(1);
    const resynced = stateById((await request('GET', `/api/persons/${pid}/linkedin/status`)).body.positions);
    expect(resynced[entryA]).toBe('synced');
  });
});
