-- 017: sparse JSON patch merged over an entry's fields at resolve time, so a variant
-- can override ANY field (position, date, location...); subsumes text_override.
ALTER TABLE entry_overrides ADD COLUMN fields_override JSON;
