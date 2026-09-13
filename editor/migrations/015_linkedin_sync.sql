-- 015: LinkedIn / Indeed / Handshake sync tracking. None of those sites exposes a
-- profile-write API, so the CV stays the source of truth and this records what was
-- last pasted: one fingerprint per experience entry. cv_linkedin_status compares the
-- current fingerprint against it to say synced | drifted | new. `synced_at` is an
-- app-set ISO string. The person_id FK cascades, so dropping a person clears it.
CREATE TABLE linkedin_sync (
  person_id   INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  entry_id    INTEGER NOT NULL,
  fingerprint TEXT    NOT NULL,
  synced_at   TEXT    NOT NULL,
  PRIMARY KEY (person_id, entry_id)
);
