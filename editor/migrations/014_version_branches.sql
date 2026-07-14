-- 014: branches, provenance tags, and a parent chain for versions (ADR-006 inc 3).
--
-- Additive columns on the versions table (013). `branch` groups checkpoints into
-- audience lines (a fork stays on its own line); `parent_id` records the provenance
-- chain a checkpoint descends from; `tag` is a frozen provenance name. All existing
-- rows default to the 'main' line.
ALTER TABLE versions ADD COLUMN branch TEXT NOT NULL DEFAULT 'main';
ALTER TABLE versions ADD COLUMN parent_id INTEGER;
ALTER TABLE versions ADD COLUMN tag TEXT;

CREATE INDEX idx_versions_branch ON versions(person_id, branch, id DESC);
