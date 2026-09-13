-- 014: `branch` groups checkpoints into audience lines, `parent_id` is the provenance
-- chain, `tag` a frozen provenance name. Existing rows default to the 'main' line.
ALTER TABLE versions ADD COLUMN branch TEXT NOT NULL DEFAULT 'main';
ALTER TABLE versions ADD COLUMN parent_id INTEGER;
ALTER TABLE versions ADD COLUMN tag TEXT;

CREATE INDEX idx_versions_branch ON versions(person_id, branch, id DESC);
