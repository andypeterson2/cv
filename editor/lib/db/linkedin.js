/**
 * LinkedIn sync tracking for CvDatabase (migration 015). The pure exporter
 * (lib/linkedin.js) turns a resolved variant into work-history blocks, each with a
 * fingerprint; this stores the fingerprint that was last pasted, per experience
 * entry, and reports drift. The comparison is the point — after any edit, status
 * names exactly which positions are now stale on LinkedIn.
 *
 * Mixed onto the prototype (see db.js / applyMixin); `this` === the CvDatabase
 * instance, sharing its prepared statements + db handle.
 */
class Linkedin {
  /** The person that owns a variant, or null — lets a variant-scoped tool key the
   *  per-person sync table without a second round trip. */
  linkedinPersonForVariant(variantId) {
    const v = this._stmts.getVariant.get(variantId);
    return v ? v.person_id : null;
  }

  /** Stored sync rows for a person: Map(entry_id → { fingerprint, syncedAt }). */
  getLinkedinSync(personId) {
    const map = new Map();
    for (const r of this._stmts.linkedinSyncByPerson.all(personId)) {
      map.set(r.entry_id, { fingerprint: r.fingerprint, syncedAt: r.synced_at });
    }
    return map;
  }

  /**
   * Per-entry drift for the given current positions (from lib/linkedin.exportLinkedin):
   * `new` (never synced), `synced` (fingerprint matches), or `drifted` (changed since
   * the last paste). Comparison only — writes happen in markLinkedinSynced.
   */
  linkedinStatus(personId, positions) {
    const stored = this.getLinkedinSync(personId);
    return positions.map((p) => {
      const s = stored.get(p.entryId);
      const state = !s ? 'new' : s.fingerprint === p.fingerprint ? 'synced' : 'drifted';
      return {
        entryId: p.entryId,
        title: p.title,
        company: p.company,
        state,
        syncedAt: s ? s.syncedAt : null,
      };
    });
  }

  /**
   * Stamp the current fingerprint + `syncedAt` for each { entryId, fingerprint } —
   * called after the user pastes. Upserts in one transaction; returns the count.
   */
  markLinkedinSynced(personId, entries, syncedAt) {
    const tx = this.db.transaction(() => {
      for (const e of entries) {
        this._stmts.upsertLinkedinSync.run(personId, e.entryId, e.fingerprint, syncedAt);
      }
    });
    tx();
    return entries.length;
  }
}

module.exports = Linkedin;
