-- 013: version history (ADR-006 increment 1).
--
-- A checkpoint stores the person's full authoritative export blob (the same
-- import-compatible tree GET /persons/:id/export returns); restore re-imports it
-- over the cleared person. `created_at` is epoch milliseconds, set by the app, so
-- the client can sort and format it without parsing. The person_id FK cascades:
-- deleting a person drops its history with it.
CREATE TABLE versions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id   INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  label       TEXT NOT NULL DEFAULT '',
  hash        TEXT,
  doc         TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX idx_versions_person ON versions(person_id, id DESC);
