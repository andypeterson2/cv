/**
 * The per-user gate on the id-addressed content routes: sections, entries, items,
 * and the nested ids reached through a parent. Requests name their user with
 * X-User-Id, which attachUser trusts when no CV_ORIGIN_SECRET is configured (as in
 * these tests). A stranger gets 404 and changes nothing, so an id stays opaque.
 */
const http = require('http');
const CvDatabase = require('../../lib/db');

let server;
let port;
let db;

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
let sid;
let eid;
let iid;
let stranger;
beforeEach(async () => {
  db.clearAllContent();
  pid = Number((await request('POST', '/api/persons', { name: 'Owner' })).body.id);
  sid = Number(
    (
      await request('POST', `/api/persons/${pid}/sections`, {
        slug: 'experience',
        type: 'experience',
        title: 'Experience',
      })
    ).body.id,
  );
  eid = Number(
    (await request('POST', `/api/sections/${sid}/entries`, { fields: { position: 'Engineer' } }))
      .body.id,
  );
  iid = Number(
    (await request('POST', `/api/entries/${eid}/items`, { content: 'Built frontend' })).body.id,
  );
  stranger = db.upsertUser({ googleSub: 'sub-stranger', email: 's@x.com', name: 'S' });
});

describe('sections', () => {
  test('a stranger cannot read, rename, or delete a section', async () => {
    expect((await request('GET', `/api/sections/${sid}`, undefined, stranger)).status).toBe(404);
    expect(
      (await request('PUT', `/api/sections/${sid}`, { title: 'hijacked' }, stranger)).status,
    ).toBe(404);
    expect((await request('DELETE', `/api/sections/${sid}`, undefined, stranger)).status).toBe(404);
    expect((await request('GET', `/api/sections/${sid}`)).body.title).toBe('Experience');
  });

  test('a stranger cannot add an entry to it or reorder its entries', async () => {
    expect(
      (await request('POST', `/api/sections/${sid}/entries`, { fields: {} }, stranger)).status,
    ).toBe(404);
    expect(
      (await request('PATCH', `/api/sections/${sid}/entries/order`, { ids: [eid] }, stranger))
        .status,
    ).toBe(404);
    expect((await request('GET', `/api/sections/${sid}`)).body.entries).toHaveLength(1);
  });
});

describe('entries', () => {
  test('a stranger cannot read, edit, or delete an entry', async () => {
    expect((await request('GET', `/api/entries/${eid}`, undefined, stranger)).status).toBe(404);
    expect(
      (await request('PUT', `/api/entries/${eid}`, { fields: { position: 'x' } }, stranger)).status,
    ).toBe(404);
    expect((await request('DELETE', `/api/entries/${eid}`, undefined, stranger)).status).toBe(404);
    expect((await request('GET', `/api/entries/${eid}`)).body.fields.position).toBe('Engineer');
  });

  test('a stranger cannot add a bullet, reorder bullets, or touch tags', async () => {
    expect(
      (await request('POST', `/api/entries/${eid}/items`, { content: 'x' }, stranger)).status,
    ).toBe(404);
    expect(
      (await request('PATCH', `/api/entries/${eid}/items/order`, { ids: [iid] }, stranger)).status,
    ).toBe(404);
    expect(
      (await request('POST', `/api/entries/${eid}/tags`, { tags: ['stolen'] }, stranger)).status,
    ).toBe(404);
    expect(
      (await request('DELETE', `/api/entries/${eid}/tags/frontend`, undefined, stranger)).status,
    ).toBe(404);
    const entry = (await request('GET', `/api/entries/${eid}`)).body;
    expect(entry.items).toHaveLength(1);
    expect(entry.tags).toEqual([]);
  });
});

describe('items', () => {
  test('a stranger cannot edit, delete, or tag a bullet', async () => {
    expect(
      (await request('PUT', `/api/items/${iid}`, { content: 'hijacked' }, stranger)).status,
    ).toBe(404);
    expect((await request('DELETE', `/api/items/${iid}`, undefined, stranger)).status).toBe(404);
    expect(
      (await request('POST', `/api/items/${iid}/tags`, { tags: ['stolen'] }, stranger)).status,
    ).toBe(404);
    expect((await request('DELETE', `/api/items/${iid}/tags/x`, undefined, stranger)).status).toBe(
      404,
    );
    const items = (await request('GET', `/api/entries/${eid}`)).body.items;
    expect(items).toHaveLength(1);
    expect(items[0].content).toBe('Built frontend');
    expect(items[0].tags).toEqual([]);
  });
});

describe('a missing id 404s the same way as a cross-user one', () => {
  test('sections, entries, and items', async () => {
    expect((await request('GET', '/api/sections/999999')).status).toBe(404);
    expect((await request('GET', '/api/entries/999999')).status).toBe(404);
    expect((await request('PUT', '/api/items/999999', { content: 'x' })).status).toBe(404);
  });
});

describe('nested ids stay inside the parent in the path', () => {
  test("reordering a section's entries cannot move another section's entry", async () => {
    const other = Number(
      (
        await request('POST', `/api/persons/${pid}/sections`, {
          slug: 'projects',
          type: 'projects',
          title: 'Projects',
        })
      ).body.id,
    );
    const a = Number(
      (await request('POST', `/api/sections/${other}/entries`, { fields: { position: 'A' } })).body
        .id,
    );
    const b = Number(
      (await request('POST', `/api/sections/${other}/entries`, { fields: { position: 'B' } })).body
        .id,
    );

    // Through the OTHER section's path, so the ids are foreign to it.
    await request('PATCH', `/api/sections/${sid}/entries/order`, { ids: [b, a] });
    expect(
      (await request('GET', `/api/sections/${other}`)).body.entries.map((e) => e.fields.position),
    ).toEqual(['A', 'B']);
  });

  test("reordering an entry's bullets cannot move another entry's bullet", async () => {
    const other = Number(
      (await request('POST', `/api/sections/${sid}/entries`, { fields: { position: 'Other' } }))
        .body.id,
    );
    const a = Number(
      (await request('POST', `/api/entries/${other}/items`, { content: 'A' })).body.id,
    );
    const b = Number(
      (await request('POST', `/api/entries/${other}/items`, { content: 'B' })).body.id,
    );

    await request('PATCH', `/api/entries/${eid}/items/order`, { ids: [b, a] });
    expect(
      (await request('GET', `/api/entries/${other}`)).body.items.map((i) => i.content),
    ).toEqual(['A', 'B']);
  });

  test("a cover letter's paragraph cannot be edited or deleted through another variant", async () => {
    const mine = Number(
      (await request('POST', `/api/persons/${pid}/variants`, { name: 'CL', kind: 'coverletter' }))
        .body.id,
    );
    const other = Number(
      (await request('POST', `/api/persons/${pid}/variants`, { name: 'CL2', kind: 'coverletter' }))
        .body.id,
    );
    const lid = Number(
      (
        await request('POST', `/api/variants/${mine}/letter-sections`, {
          title: 'Intro',
          body: 'Hello',
        })
      ).body.id,
    );

    await request('PUT', `/api/variants/${other}/letter-sections/${lid}`, { body: 'hijacked' });
    expect((await request('GET', `/api/variants/${mine}/letter-sections`)).body[0].body).toBe(
      'Hello',
    );

    await request('DELETE', `/api/variants/${other}/letter-sections/${lid}`);
    expect((await request('GET', `/api/variants/${mine}/letter-sections`)).body).toHaveLength(1);
  });
});
