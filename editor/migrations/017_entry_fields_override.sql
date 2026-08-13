-- 017 — Field-level entry overrides.
--
-- entry_overrides could vary only { included, text_override, sort_override }, and
-- text_override reached only fields.text (paragraph/summary sections). Add a
-- sparse JSON patch so a variant can override ANY entry field per-variant — the
-- role subheading (fields.position), date, location, etc. — merged over the
-- entry's fields at resolve time. This generalizes (and subsumes) text_override.
-- Nullable + additive: existing rows are untouched.
ALTER TABLE entry_overrides ADD COLUMN fields_override JSON;
