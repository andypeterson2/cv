/**
 * The persons readable without authentication (the demo CV the logged-out site
 * shows), from CV_PUBLIC_PERSON_IDS — a comma-separated id list. Ids are kept as
 * strings so callers compare with String(personId).
 */
function publicPersonIdSet(raw) {
  return new Set(
    String(raw ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

module.exports = { publicPersonIdSet };
