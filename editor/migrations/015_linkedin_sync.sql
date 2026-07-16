-- 015: LinkedIn / Indeed / Handshake sync tracking.
--
-- None of those sites exposes an individual profile-write API, so the CV stays the
-- source of truth and we track what was last pasted: one fingerprint per experience
-- entry (see lib/linkedin.js for the fingerprint, lib/db/linkedin.js for drift).
-- cv_linkedin_status compares the current fingerprint against synced to say
-- synced | drifted | new. `synced_at` is an app-set ISO string. The person_id FK
-- cascades — dropping a person clears its sync state with it.
CREATE TABLE linkedin_sync (
  person_id   INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  entry_id    INTEGER NOT NULL,
  fingerprint TEXT    NOT NULL,
  synced_at   TEXT    NOT NULL,
  PRIMARY KEY (person_id, entry_id)
);
