-- 022: per-variant overrides of personal.* header fields (position, quote, ...).
-- Keys are unprefixed, matching getPersonal() output. No row means inherit the
-- person value; a row holding '' suppresses the field for this variant.
CREATE TABLE variant_personal (
  variant_id INTEGER NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  key        TEXT    NOT NULL,
  value      TEXT,
  PRIMARY KEY (variant_id, key)
) WITHOUT ROWID;
