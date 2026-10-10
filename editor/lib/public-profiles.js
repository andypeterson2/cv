/**
 * The profiles readable without authentication (the demo CV the logged-out site
 * shows), from CV_PUBLIC_PROFILE_IDS — a comma-separated id list. Ids are kept as
 * strings so callers compare with String(profileId).
 */
function publicProfileIdSet(raw) {
  return new Set(
    String(raw ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

module.exports = { publicProfileIdSet };
