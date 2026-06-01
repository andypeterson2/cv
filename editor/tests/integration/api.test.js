/**
 * Integration tests for the normalized, stateless CV Editor API.
 * Uses an in-memory SQLite DB; each test starts from a clean slate.
 */
const http = require('http');
const CvDatabase = require('../../lib/db');

let server;
let port;
let db;

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: 'localhost', port, path: urlPath, method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

beforeAll(async () => {
  const app = require('../../server');
  db = new CvDatabase(':memory:');
  app.setDb(db);
  await new Promise((resolve) => { server = app.listen(0, () => { port = server.address().port; resolve(); }); });
});

afterAll(async () => { if (server) await new Promise((r) => server.close(r)); });

let pid;
beforeEach(async () => {
  db.clearAllContent();
  pid = Number((await request('POST', '/api/persons', { name: 'Test' })).body.id);
});

// Build a small master CV for `pid`; returns created ids.
async function buildMaster() {
  const summary = (await request('POST', `/api/persons/${pid}/sections`, { slug: 'summary', type: 'summary', title: 'Summary' })).body.id;
  const sEntry = (await request('POST', `/api/sections/${summary}/entries`, { fields: { text: 'Full summary' } })).body.id;
  const exp = (await request('POST', `/api/persons/${pid}/sections`, { slug: 'experience', type: 'experience', title: 'Experience' })).body.id;
  const e1 = (await request('POST', `/api/sections/${exp}/entries`, { fields: { position: 'Engineer' } })).body.id;
  const i1 = (await request('POST', `/api/entries/${e1}/items`, { content: 'Built frontend' })).body.id;
  const e2 = (await request('POST', `/api/sections/${exp}/entries`, { fields: { position: 'Intern' } })).body.id;
  return { summary, sEntry, exp, e1, i1, e2 };
}

describe('Persons', () => {
  test('create, list, get master, rename, delete', async () => {
    expect((await request('GET', '/api/persons')).body.persons.map((p) => p.name)).toContain('Test');
    const master = await request('GET', `/api/persons/${pid}`);
    expect(master.status).toBe(200);
    expect(master.body.person.name).toBe('Test');

    expect((await request('PUT', `/api/persons/${pid}`, { name: 'Renamed' })).status).toBe(200);
    expect((await request('GET', `/api/persons/${pid}`)).body.person.name).toBe('Renamed');

    expect((await request('DELETE', `/api/persons/${pid}`)).status).toBe(200);
    expect((await request('GET', `/api/persons/${pid}`)).status).toBe(404);
  });

  test('duplicate name → 409, invalid id → 400/404', async () => {
    expect((await request('POST', '/api/persons', { name: 'Test' })).status).toBe(409);
    expect((await request('GET', '/api/persons/abc')).status).toBe(400);
    expect((await request('GET', '/api/persons/99999')).status).toBe(404);
    expect((await request('POST', '/api/persons', {})).status).toBe(400);
  });
});

describe('Personal info', () => {
  test('patch then get', async () => {
    expect((await request('PATCH', `/api/persons/${pid}/personal`, { firstName: 'Ada', lastName: 'Lovelace' })).status).toBe(200);
    expect((await request('GET', `/api/persons/${pid}/personal`)).body.firstName).toBe('Ada');
  });
});

describe('Sections / entries / items', () => {
  test('CRUD and ordering', async () => {
    const { exp, e1, e2 } = await buildMaster();
    const section = await request('GET', `/api/sections/${exp}`);
    expect(section.body.entries).toHaveLength(2);

    // reorder entries
    await request('PATCH', `/api/sections/${exp}/entries/order`, { ids: [e2, e1] });
    expect((await request('GET', `/api/sections/${exp}`)).body.entries.map((e) => e.id)).toEqual([e2, e1]);

    // update + delete entry
    await request('PUT', `/api/entries/${e1}`, { fields: { position: 'Senior Engineer' } });
    expect((await request('GET', `/api/entries/${e1}`)).body.fields.position).toBe('Senior Engineer');
    await request('DELETE', `/api/entries/${e2}`);
    expect((await request('GET', `/api/sections/${exp}`)).body.entries).toHaveLength(1);
  });

  test('duplicate slug for same person → 409', async () => {
    await request('POST', `/api/persons/${pid}/sections`, { slug: 'skills', type: 'skills', title: 'Skills' });
    expect((await request('POST', `/api/persons/${pid}/sections`, { slug: 'skills', type: 'skills', title: 'Skills' })).status).toBe(409);
  });

  test('invalid section type → 400', async () => {
    expect((await request('POST', `/api/persons/${pid}/sections`, { slug: 'x', type: 'bogus', title: 'X' })).status).toBe(400);
  });
});

describe('Tags', () => {
  test('add to entry + item, list, remove', async () => {
    const { e1, i1 } = await buildMaster();
    expect((await request('POST', `/api/entries/${e1}/tags`, { tags: ['Frontend', 'core'] })).status).toBe(200);
    await request('POST', `/api/items/${i1}/tags`, { tags: ['frontend'] });
    expect((await request('GET', `/api/persons/${pid}/tags`)).body.tags.sort()).toEqual(['core', 'frontend']);
    await request('DELETE', `/api/entries/${e1}/tags/core`);
    expect((await request('GET', `/api/entries/${e1}`)).body.tags).toEqual(['frontend']);
  });
});

describe('Variants', () => {
  test('create, rules, resolve filters by tag', async () => {
    const { exp, e1 } = await buildMaster();
    await request('POST', `/api/entries/${e1}/tags`, { tags: ['frontend'] });
    const v = (await request('POST', `/api/persons/${pid}/variants`, { name: 'FE', kind: 'resume' })).body.id;
    await request('PUT', `/api/variants/${v}/rules`, { include: ['frontend'] });

    const resolved = (await request('GET', `/api/variants/${v}/resolve`)).body;
    const expSec = resolved.sections.find((s) => s.id === 'experience');
    expect(expSec.entries.map((e) => e.fields.position)).toEqual(['Engineer']); // Intern (untagged) dropped
  });

  test('override forces inclusion against tags', async () => {
    const { e1, e2 } = await buildMaster();
    await request('POST', `/api/entries/${e1}/tags`, { tags: ['frontend'] });
    const v = (await request('POST', `/api/persons/${pid}/variants`, { name: 'V', kind: 'resume' })).body.id;
    await request('PUT', `/api/variants/${v}/rules`, { include: ['frontend'] });
    await request('PUT', `/api/variants/${v}/overrides`, { targetType: 'entry', targetId: e2, included: true });
    const resolved = (await request('GET', `/api/variants/${v}/resolve`)).body;
    const positions = resolved.sections.find((s) => s.id === 'experience').entries.map((e) => e.fields.position).sort();
    expect(positions).toEqual(['Engineer', 'Intern']);
  });

  test('variant section list controls presence/order', async () => {
    const m = await buildMaster();
    const v = (await request('POST', `/api/persons/${pid}/variants`, { name: 'V', kind: 'cv' })).body.id;
    await request('PUT', `/api/variants/${v}/sections`, { sections: [
      { sectionId: m.exp, enabled: true, sortOrder: 0 },
      { sectionId: m.summary, enabled: false, sortOrder: 1 },
    ] });
    const resolved = (await request('GET', `/api/variants/${v}/resolve`)).body;
    expect(resolved.sections.map((s) => s.id)).toEqual(['experience']); // summary disabled
  });

  test('coverletter variant: letter sections + resolve', async () => {
    const v = (await request('POST', `/api/persons/${pid}/variants`, { name: 'CL', kind: 'coverletter' })).body.id;
    await request('POST', `/api/variants/${v}/letter-sections`, { title: 'Intro', body: 'Hello' });
    const resolved = (await request('GET', `/api/variants/${v}/resolve`)).body;
    expect(resolved.variant).toBe('coverletter');
    expect(resolved.coverletter.sections.map((s) => s.title)).toEqual(['Intro']);
  });

  test('invalid kind → 400; unknown variant → 404', async () => {
    expect((await request('POST', `/api/persons/${pid}/variants`, { name: 'X', kind: 'bad' })).status).toBe(400);
    expect((await request('GET', '/api/variants/99999')).status).toBe(404);
    expect((await request('GET', '/api/variants/99999/resolve')).status).toBe(404);
  });
});

describe('Export / import round-trip', () => {
  test('exported new-shape re-imports faithfully', async () => {
    const { e1 } = await buildMaster();
    await request('POST', `/api/entries/${e1}/tags`, { tags: ['frontend'] });
    await request('PATCH', `/api/persons/${pid}/personal`, { firstName: 'Round' });
    const v = (await request('POST', `/api/persons/${pid}/variants`, { name: 'FE', kind: 'resume' })).body.id;
    await request('PUT', `/api/variants/${v}/rules`, { include: ['frontend'] });

    const exported = (await request('GET', `/api/persons/${pid}/export`)).body;

    const pid2 = (await request('POST', '/api/persons', { name: 'Clone' })).body.id;
    expect((await request('POST', `/api/persons/${pid2}/import`, exported)).status).toBe(200);

    const master = (await request('GET', `/api/persons/${pid2}`)).body;
    expect(master.personal.firstName).toBe('Round');
    expect(master.tags).toEqual(['frontend']);
    const feVariant = master.variants.find((x) => x.name === 'FE');
    expect(feVariant.rules.include).toEqual(['frontend']);
  });
});

describe('Catalog + health', () => {
  test('catalog returns section types; health reports persons', async () => {
    expect((await request('GET', '/api/catalog')).body.validSectionTypes).toContain('experience');
    const health = await request('GET', '/api/health');
    expect(health.body.status).toBe('ok');
    expect(health.body.persons).toBeGreaterThanOrEqual(1);
  });
});
