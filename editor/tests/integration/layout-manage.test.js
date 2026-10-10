/**
 * Layout management API: deleting, and the ids uploaded layouts are stored under.
 * Bundle validation (missing manifest, security scan, builtin ids) is covered by
 * the GitHub link tests.
 */
const http = require('http');
const CvDatabase = require('../../lib/db');
const { seedBuiltinLayouts } = require('../../lib/render/seed');

let server, port, db;

function del(id) {
  return new Promise((resolve) => {
    http
      .request(
        { hostname: 'localhost', port, path: `/api/layouts/${id}`, method: 'DELETE' },
        (res) => {
          res.on('data', () => {});
          res.on('end', () => resolve(res.statusCode));
        },
      )
      .end();
  });
}

beforeAll(async () => {
  const app = require('../../server');
  db = new CvDatabase(':memory:');
  db.clearAllContent();
  seedBuiltinLayouts(db);
  app.setDb(db);
  await new Promise((r) => {
    server = app.listen(0, () => {
      port = server.address().port;
      r();
    });
  });
});

afterAll(async () => {
  if (server) await new Promise((r) => server.close(r));
});

describe('DELETE /api/layouts/:id', () => {
  it('refuses to delete a builtin (409)', async () => {
    expect(await del('awesome-cv')).toBe(409);
  });
  it('404 for an unknown layout', async () => {
    expect(await del('ghost')).toBe(404);
  });
});

describe('layout ids', () => {
  it('stores an upload under an id that carries the installer', () => {
    // Two accounts installing the same manifest id must not collide on the
    // layouts primary key, which the bare manifest id would.
    const a = db.upsertUser({ googleSub: 'g-a', email: 'a@x.test' });
    const b = db.upsertUser({ googleSub: 'g-b', email: 'b@x.test' });
    db.upsertLayout({ id: `u${a}-modern`, name: 'M', kinds: ['cv'], source: 'upload', userId: a });
    db.upsertLayout({ id: `u${b}-modern`, name: 'M', kinds: ['cv'], source: 'upload', userId: b });
    expect(db.listLayouts(a).map((l) => l.id)).toContain(`u${a}-modern`);
    expect(db.listLayouts(a).map((l) => l.id)).not.toContain(`u${b}-modern`);
    expect(db.listLayouts(b).map((l) => l.id)).toContain(`u${b}-modern`);
  });

  it('re-verifying updates the row in place instead of adding a second one', async () => {
    // The row id carries the installer; its manifest keeps the bare id it was
    // authored with. Re-upserting by the manifest id would insert a duplicate.
    const owner = db.ownerUserId();
    const storedId = `u${owner}-cand`;
    db.upsertLayout({
      id: storedId,
      name: 'Cand',
      kinds: ['cv'],
      source: 'upload',
      userId: owner,
      manifest: { id: 'cand', name: 'Cand', engine: 'nunjucks', kinds: ['cv'], entry: {} },
    });
    const before = db.listLayouts(owner).length;

    // No bundle on disk, so verification fails at the static stage — no xelatex needed.
    const res = await fetch(`http://localhost:${port}/api/layouts/${storedId}/verify`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(false);

    const after = db.listLayouts(owner);
    expect(after.length).toBe(before);
    expect(after.filter((l) => l.id === storedId)).toHaveLength(1);
    expect(after.some((l) => l.id === 'cand')).toBe(false);
    expect(db.getLayout(storedId, owner).status).toBe('invalid');
    db.deleteLayout(storedId, owner);
  });
});
