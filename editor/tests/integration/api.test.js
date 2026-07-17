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

// Build a small main CV for `pid`; returns created ids.
async function buildMain() {
  const summary = (await request('POST', `/api/persons/${pid}/sections`, { slug: 'summary', type: 'summary', title: 'Summary' })).body.id;
  const sEntry = (await request('POST', `/api/sections/${summary}/entries`, { fields: { text: 'Full summary' } })).body.id;
  const exp = (await request('POST', `/api/persons/${pid}/sections`, { slug: 'experience', type: 'experience', title: 'Experience' })).body.id;
  const e1 = (await request('POST', `/api/sections/${exp}/entries`, { fields: { position: 'Engineer' } })).body.id;
  const i1 = (await request('POST', `/api/entries/${e1}/items`, { content: 'Built frontend' })).body.id;
  const e2 = (await request('POST', `/api/sections/${exp}/entries`, { fields: { position: 'Intern' } })).body.id;
  return { summary, sEntry, exp, e1, i1, e2 };
}

describe('Persons', () => {
  test('create, list, get main, rename, delete', async () => {
    expect((await request('GET', '/api/persons')).body.persons.map((p) => p.name)).toContain('Test');
    const main = await request('GET', `/api/persons/${pid}`);
    expect(main.status).toBe(200);
    expect(main.body.person.name).toBe('Test');

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
    const { exp, e1, e2 } = await buildMain();
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
    const { e1, i1 } = await buildMain();
    expect((await request('POST', `/api/entries/${e1}/tags`, { tags: ['Frontend', 'core'] })).status).toBe(200);
    await request('POST', `/api/items/${i1}/tags`, { tags: ['frontend'] });
    expect((await request('GET', `/api/persons/${pid}/tags`)).body.tags.sort()).toEqual(['core', 'frontend']);
    await request('DELETE', `/api/entries/${e1}/tags/core`);
    expect((await request('GET', `/api/entries/${e1}`)).body.tags).toEqual(['frontend']);
  });
});

describe('Fuzzy tags', () => {
  test('normalization folds case/separator variants and de-dupes', async () => {
    const { e1 } = await buildMain();
    await request('POST', `/api/entries/${e1}/tags`, { tags: ['Front End', 'front_end', 'Machine Learning'] });
    expect((await request('GET', `/api/entries/${e1}`)).body.tags).toEqual(['front-end', 'machine-learning']);
    expect((await request('GET', `/api/persons/${pid}/tags`)).body.tags).toEqual(['front-end', 'machine-learning']);
  });

  test('tags?withCounts returns usage counts', async () => {
    const { e1, i1 } = await buildMain();
    await request('POST', `/api/entries/${e1}/tags`, { tags: ['frontend'] });
    await request('POST', `/api/items/${i1}/tags`, { tags: ['frontend'] });
    const body = (await request('GET', `/api/persons/${pid}/tags?withCounts=1`)).body;
    expect(body.tags).toEqual([{ tag: 'frontend', count: 2 }]);
  });

  test('search finds a typo + reports score/via; missing q → 400', async () => {
    const { e1 } = await buildMain();
    await request('POST', `/api/entries/${e1}/tags`, { tags: ['frontend', 'kubernetes'] });
    const res = (await request('GET', `/api/persons/${pid}/tags/search?q=fronend`)).body;
    expect(res.results[0].tag).toBe('frontend');
    expect(res.results[0].score).toBeGreaterThan(0.5);
    expect(res.results.find((r) => r.tag === 'kubernetes')).toBeUndefined();
    expect((await request('GET', `/api/persons/${pid}/tags/search`)).status).toBe(400);
  });

  test('alias folds existing + future tags into the canonical', async () => {
    const { e1, e2 } = await buildMain();
    await request('POST', `/api/entries/${e1}/tags`, { tags: ['ml'] }); // before the alias exists
    expect((await request('PUT', `/api/persons/${pid}/tag-aliases`, { alias: 'ml', canonical: 'machine-learning' })).status).toBe(200);

    // existing 'ml' was folded retroactively
    expect((await request('GET', `/api/entries/${e1}`)).body.tags).toEqual(['machine-learning']);
    // future writes of the alias store the canonical
    await request('POST', `/api/entries/${e2}/tags`, { tags: ['ml'] });
    expect((await request('GET', `/api/entries/${e2}`)).body.tags).toEqual(['machine-learning']);
    expect((await request('GET', `/api/persons/${pid}/tag-aliases`)).body.aliases).toEqual([
      { alias: 'ml', canonical: 'machine-learning', source: 'manual' },
    ]);
  });

  test('alias search surfaces the canonical as an exact hit', async () => {
    const { e1 } = await buildMain();
    await request('POST', `/api/entries/${e1}/tags`, { tags: ['machine-learning'] });
    await request('PUT', `/api/persons/${pid}/tag-aliases`, { alias: 'ml', canonical: 'machine-learning' });
    const res = (await request('GET', `/api/persons/${pid}/tags/search?q=ml`)).body;
    expect(res.results[0]).toMatchObject({ tag: 'machine-learning', via: 'alias', score: 1 });
  });

  test('self-alias and cycles are rejected with 409', async () => {
    expect((await request('PUT', `/api/persons/${pid}/tag-aliases`, { alias: 'x', canonical: 'x' })).status).toBe(409);
    expect((await request('PUT', `/api/persons/${pid}/tag-aliases`, { alias: 'a', canonical: 'b' })).status).toBe(200);
    expect((await request('PUT', `/api/persons/${pid}/tag-aliases`, { alias: 'b', canonical: 'a' })).status).toBe(409);
  });

  test('rule expansion materializes near-miss tags; resolution stays exact', async () => {
    const { e1, e2 } = await buildMain();
    await request('POST', `/api/entries/${e1}/tags`, { tags: ['frontend'] });
    await request('POST', `/api/entries/${e2}/tags`, { tags: ['front-end'] });
    const v = (await request('POST', `/api/persons/${pid}/variants`, { name: 'FE', kind: 'resume' })).body.id;
    await request('PUT', `/api/variants/${v}/rules`, { include: ['frontend'] });

    // Exact rule catches only e1.
    let resolved = (await request('GET', `/api/variants/${v}/resolve`)).body;
    expect(resolved.sections.find((s) => s.id === 'experience').entries.map((e) => e.fields.position)).toEqual(['Engineer']);

    // Expand grows the include set to the near-miss tag, written back concretely.
    const exp = (await request('POST', `/api/variants/${v}/rules/expand`, { threshold: 0.6 })).body;
    expect(exp.added.map((a) => a.tag)).toContain('front-end');
    expect((await request('GET', `/api/variants/${v}`)).body.rules.include.sort()).toEqual(['front-end', 'frontend']);

    // Now both entries resolve — via concrete tags, not fuzzy matching at render time.
    resolved = (await request('GET', `/api/variants/${v}/resolve`)).body;
    expect(resolved.sections.find((s) => s.id === 'experience').entries.map((e) => e.fields.position).sort())
      .toEqual(['Engineer', 'Intern']);
  });
});

describe('Tag catalog + suggestion', () => {
  test('catalog PUT → GET → DELETE round-trip', async () => {
    expect((await request('PUT', `/api/persons/${pid}/tags/catalog`, { tag: 'Front End', category: 'skill' })).status).toBe(200);
    let cat = (await request('GET', `/api/persons/${pid}/tags/catalog`)).body.catalog;
    expect(cat).toEqual([{ tag: 'front-end', description: null, category: 'skill' }]);
    expect((await request('DELETE', `/api/persons/${pid}/tags/catalog/front-end`)).status).toBe(200);
    expect((await request('GET', `/api/persons/${pid}/tags/catalog`)).body.catalog).toEqual([]);
  });

  test('suggest returns ranked existing tags and does NOT mutate the vocabulary', async () => {
    const { e1 } = await buildMain();
    await request('POST', `/api/entries/${e1}/tags`, { tags: ['frontend'] });
    await request('PUT', `/api/persons/${pid}/tags/catalog`, { tag: 'react' });
    const before = (await request('GET', `/api/persons/${pid}/tags`)).body.tags;

    const res = (await request('POST', `/api/persons/${pid}/tags/suggest`, { text: 'Built the React frontend library' })).body;
    const tags = res.results.map((r) => r.tag);
    expect(tags).toContain('frontend');
    expect(tags).toContain('react');
    expect(res.results.find((r) => r.tag === 'react').inCatalog).toBe(true);

    // suggest-not-apply: the tag vocabulary is unchanged
    expect((await request('GET', `/api/persons/${pid}/tags`)).body.tags).toEqual(before);
  });

  test('seed promotes usage vocab; suggest-bulk returns per-item candidates', async () => {
    const { e1, i1 } = await buildMain();
    await request('POST', `/api/entries/${e1}/tags`, { tags: ['frontend'] });
    expect((await request('POST', `/api/persons/${pid}/tags/catalog/seed`)).body.added).toBe(1);

    const bulk = (await request('POST', `/api/persons/${pid}/tags/suggest-bulk`, {})).body;
    expect(bulk.count).toBeGreaterThan(0);
    const i1row = bulk.items.find((x) => x.target === 'item' && x.id === i1); // "Built frontend"
    expect(i1row.suggestions.map((s) => s.tag)).toContain('frontend');
  });

  test('400s: suggest without text, catalog without tag', async () => {
    expect((await request('POST', `/api/persons/${pid}/tags/suggest`, {})).status).toBe(400);
    expect((await request('PUT', `/api/persons/${pid}/tags/catalog`, { description: 'no tag' })).status).toBe(400);
  });
});

describe('Variants', () => {
  test('create, rules, resolve filters by tag', async () => {
    const { exp, e1 } = await buildMain();
    await request('POST', `/api/entries/${e1}/tags`, { tags: ['frontend'] });
    const v = (await request('POST', `/api/persons/${pid}/variants`, { name: 'FE', kind: 'resume' })).body.id;
    await request('PUT', `/api/variants/${v}/rules`, { include: ['frontend'] });

    const resolved = (await request('GET', `/api/variants/${v}/resolve`)).body;
    const expSec = resolved.sections.find((s) => s.id === 'experience');
    expect(expSec.entries.map((e) => e.fields.position)).toEqual(['Engineer']); // Intern (untagged) dropped
  });

  test('override forces inclusion against tags', async () => {
    const { e1, e2 } = await buildMain();
    await request('POST', `/api/entries/${e1}/tags`, { tags: ['frontend'] });
    const v = (await request('POST', `/api/persons/${pid}/variants`, { name: 'V', kind: 'resume' })).body.id;
    await request('PUT', `/api/variants/${v}/rules`, { include: ['frontend'] });
    await request('PUT', `/api/variants/${v}/overrides`, { targetType: 'entry', targetId: e2, included: true });
    const resolved = (await request('GET', `/api/variants/${v}/resolve`)).body;
    const positions = resolved.sections.find((s) => s.id === 'experience').entries.map((e) => e.fields.position).sort();
    expect(positions).toEqual(['Engineer', 'Intern']);
  });

  test('variant section list controls presence/order', async () => {
    const m = await buildMain();
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

  test('coverletter variant: per-variant header via PATCH /header, GET, resolve', async () => {
    const v = (await request('POST', `/api/persons/${pid}/variants`, { name: 'To Acme', kind: 'coverletter' })).body.id;
    expect((await request('PATCH', `/api/variants/${v}/header`, { recipientName: 'Acme', opening: 'Dear Acme,' })).status).toBe(200);

    expect((await request('GET', `/api/variants/${v}`)).body.header).toMatchObject({ recipientName: 'Acme', opening: 'Dear Acme,' });
    expect((await request('GET', `/api/variants/${v}/resolve`)).body.coverletter.recipientName).toBe('Acme');

    // a second letter on the same person keeps its own recipient — the whole point
    const v2 = (await request('POST', `/api/persons/${pid}/variants`, { name: 'To Globex', kind: 'coverletter' })).body.id;
    await request('PATCH', `/api/variants/${v2}/header`, { recipientName: 'Globex' });
    expect((await request('GET', `/api/variants/${v}`)).body.header.recipientName).toBe('Acme');
    expect((await request('GET', `/api/variants/${v2}`)).body.header.recipientName).toBe('Globex');

    expect((await request('PATCH', `/api/variants/${v}/header`, {})).status).toBe(400); // empty rejected
  });

  test('invalid kind → 400; unknown variant → 404', async () => {
    expect((await request('POST', `/api/persons/${pid}/variants`, { name: 'X', kind: 'bad' })).status).toBe(400);
    expect((await request('GET', '/api/variants/99999')).status).toBe(404);
    expect((await request('GET', '/api/variants/99999/resolve')).status).toBe(404);
  });
});

describe('Export / import round-trip', () => {
  test('exported new-shape re-imports faithfully', async () => {
    const { e1 } = await buildMain();
    await request('POST', `/api/entries/${e1}/tags`, { tags: ['frontend'] });
    await request('PATCH', `/api/persons/${pid}/personal`, { firstName: 'Round' });
    const v = (await request('POST', `/api/persons/${pid}/variants`, { name: 'FE', kind: 'resume' })).body.id;
    await request('PUT', `/api/variants/${v}/rules`, { include: ['frontend'] });

    const exported = (await request('GET', `/api/persons/${pid}/export`)).body;

    const pid2 = (await request('POST', '/api/persons', { name: 'Clone' })).body.id;
    expect((await request('POST', `/api/persons/${pid2}/import`, exported)).status).toBe(200);

    const main = (await request('GET', `/api/persons/${pid2}`)).body;
    expect(main.personal.firstName).toBe('Round');
    expect(main.tags).toEqual(['frontend']);
    const feVariant = main.variants.find((x) => x.name === 'FE');
    expect(feVariant.rules.include).toEqual(['frontend']);
  });
});

describe('Catalog + health', () => {
  test('catalog returns section types; health states liveness and nothing else', async () => {
    expect((await request('GET', '/api/catalog')).body.validSectionTypes).toContain('experience');
    const health = await request('GET', '/api/health');
    // The contract's required keys (website docs/api-contract/CONTRACT.md).
    expect(health.body.status).toBe('ok');
    expect(health.body.service).toBe('cv');
    expect(typeof health.body.version).toBe('string');
    expect(typeof health.body.uptime_s).toBe('number');
    // …and nothing data-shaped. /health is the ONE endpoint the origin guard leaves
    // publicly reachable (the container HEALTHCHECK needs it), so anything here is
    // world-readable forever. It used to return `persons`, disclosing how many CVs
    // exist. Pinned exactly so a well-meaning addition can't leak facts back.
    expect(health.body.persons).toBeUndefined();
    expect(Object.keys(health.body).sort()).toEqual(['service', 'status', 'uptime_s', 'version']);
  });
});

describe('Compile endpoint hardening', () => {
  test('the compile route is rate-limited (429 once the per-window cap is exceeded)', async () => {
    // Hit a non-existent variant so each request returns fast (404) without xelatex;
    // the rate-limit middleware runs first and should begin rejecting with 429.
    const statuses = [];
    for (let i = 0; i < 12; i++) {
      statuses.push((await request('GET', '/api/variants/999999/pdf')).status);
    }
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
    expect(statuses.every((s) => s === 404 || s === 429)).toBe(true);
  });
});
