-- Multi-person support: store complete CV data per person as JSON snapshots.
-- The content tables hold the active person's data; switching persons
-- saves the current snapshot and imports the new person's blob.

CREATE TABLE IF NOT EXISTS persons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  data JSON NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
