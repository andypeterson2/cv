-- CV Editor — Initial Schema
-- 7 tables, SOLID design: type-agnostic entries with JSON fields

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Singleton key-value store for personal info + cover letter header.
-- Open to new fields without schema changes.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Sections: the universal container.
-- Type tells the app how to render/serialize — not constrained by the DB.
CREATE TABLE IF NOT EXISTS sections (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT ''
);

-- Entries: ordered items within a section.
-- Fields stored as JSON — section type determines expected keys.
--   cventries:    { "position", "organization", "location", "date" }
--   cvskills:     { "category", "skills" }
--   cvhonors:     { "award", "issuer", "location", "date" }
--   cvreferences: { "name", "relation", "phone", "email" }
--   cvparagraph:  { "text" }
CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  fields JSON NOT NULL DEFAULT '{}',
  resume_included INTEGER NOT NULL DEFAULT 1
);

-- Items: ordered sub-items (bullet points) within an entry.
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  content TEXT NOT NULL DEFAULT '',
  resume_included INTEGER NOT NULL DEFAULT 1
);

-- Metrics: LaTeX variables tied to sections.
CREATE TABLE IF NOT EXISTS metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  command TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  value TEXT,
  group_name TEXT NOT NULL DEFAULT '',
  section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE
);

-- Document variants and their section ordering.
CREATE TABLE IF NOT EXISTS document_sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  variant TEXT NOT NULL,
  section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  resume_paragraph_text TEXT,
  UNIQUE(variant, section_id)
);

-- Cover letter body sections (ordered paragraphs within the letter).
CREATE TABLE IF NOT EXISTS coverletter_sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT ''
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_entries_section ON entries(section_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_items_entry ON items(entry_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_metrics_section ON metrics(section_id);
CREATE INDEX IF NOT EXISTS idx_docsec_variant ON document_sections(variant, sort_order);
