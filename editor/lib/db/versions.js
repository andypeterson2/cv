/**
 * Version history for CvDatabase (ADR-006 increment 1). A checkpoint captures the
 * person's authoritative export blob; restore clears the person's content and
 * re-imports the blob — keeping the person row (and its version history) intact.
 * Deleting the person instead would cascade its versions away, so restore never
 * touches the persons/versions rows, only content.
 *
 * Mixed onto the prototype (see db.js / applyMixin); methods run with
 * `this` === the CvDatabase instance, sharing its prepared statements + db handle.
 */
const { createHash } = require('crypto');

class Versions {
  /** Snapshot the person's current content as a checkpoint. Returns the new id, or null. */
  createVersion(personId, label = '') {
    const doc = this.getPersonExport(personId);
    if (!doc) return null;
    const json = JSON.stringify(doc);
    const hash = createHash('sha256').update(json).digest('hex');
    return this._stmts.insertVersion.run(personId, label || '', hash, json, Date.now())
      .lastInsertRowid;
  }

  /** Checkpoints for a person, newest first — metadata only (the doc blob is omitted). */
  listVersions(personId) {
    return this._stmts.versionsByPerson
      .all(personId)
      .map((r) => ({ id: r.id, label: r.label, createdAt: r.created_at }));
  }

  /** The stored document blob for one checkpoint (scoped to the person), or null. */
  getVersionDoc(personId, versionId) {
    const row = this._stmts.versionDoc.get(versionId, personId);
    return row ? JSON.parse(row.doc) : null;
  }

  /** One checkpoint in full — metadata + parsed doc, scoped to the person — or null. */
  getVersion(personId, versionId) {
    const row = this._stmts.versionFull.get(versionId, personId);
    return row
      ? { id: row.id, label: row.label, createdAt: row.created_at, doc: JSON.parse(row.doc) }
      : null;
  }

  /**
   * Restore a checkpoint: clear the person's content, then re-import the blob — one
   * transaction (importPersonData's own transaction nests as a savepoint). The
   * person row and its versions survive; only the content is replaced. Returns
   * false if the version doesn't exist for this person.
   */
  restoreVersion(personId, versionId) {
    const doc = this.getVersionDoc(personId, versionId);
    if (!doc) return false;
    const tx = this.db.transaction(() => {
      this._resetPersonContent(personId);
      this.importPersonData(personId, doc);
    });
    tx();
    return true;
  }

  /**
   * Delete a person's content while keeping the person row. Deleting sections and
   * variants cascades to entries/items/*_tags/*_overrides and rules/sections/
   * letters/header (every child FK is ON DELETE CASCADE); the three flat
   * per-person tables are cleared directly. persons + versions are untouched.
   */
  _resetPersonContent(personId) {
    this._stmts.clearSections.run(personId); // → entries → items → *_tags, *_overrides, variant_sections
    this._stmts.clearVariants.run(personId); // → rules, sections, overrides, letter sections + header
    this._stmts.clearPersonSettings.run(personId); // personal.* + coverletter.*
    this._stmts.clearTagAliases.run(personId);
    this._stmts.clearTagCatalog.run(personId);
  }
}

module.exports = Versions;
