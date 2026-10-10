/**
 * Version history for CvDatabase. A checkpoint captures the profile's
 * authoritative export blob; restore clears the profile's content and
 * re-imports the blob — keeping the profile row (and its version history) intact.
 * Deleting the profile instead would cascade its versions away, so restore never
 * touches the profiles/versions rows, only content.
 *
 * Mixed onto the CvDatabase prototype; methods run with
 * `this` === the CvDatabase instance, sharing its prepared statements + db handle.
 */

class Versions {
  /**
   * Snapshot the profile's current content as a checkpoint on `branch`, descending
   * from `parent`. Returns the new id, or null.
   */
  createVersion(profileId, label = '', branch = 'main', parent = null) {
    const doc = this.getProfileExport(profileId);
    if (!doc) return null;
    return this._stmts.insertVersion.run(
      profileId,
      label || '',
      JSON.stringify(doc),
      Date.now(),
      branch || 'main',
      parent ?? null,
    ).lastInsertRowid;
  }

  /** Checkpoints for a profile, newest first — metadata only (the doc blob is omitted). */
  listVersions(profileId) {
    return this._stmts.versionsByProfile.all(profileId).map((r) => ({
      id: r.id,
      label: r.label,
      createdAt: r.created_at,
      branch: r.branch,
      tag: r.tag ?? undefined,
      parent: r.parent_id ?? undefined,
    }));
  }

  /** Set (or clear, with a falsy value) a checkpoint's frozen provenance tag. */
  setTag(profileId, versionId, tag) {
    const value = tag && String(tag).trim() ? String(tag).trim() : null;
    return this._stmts.setVersionTag.run(value, versionId, profileId).changes > 0;
  }

  /** The stored document blob for one checkpoint (scoped to the profile), or null. */
  getVersionDoc(profileId, versionId) {
    const row = this._stmts.versionDoc.get(versionId, profileId);
    return row ? JSON.parse(row.doc) : null;
  }

  /** One checkpoint in full — metadata + parsed doc, scoped to the profile — or null. */
  getVersion(profileId, versionId) {
    const row = this._stmts.versionFull.get(versionId, profileId);
    return row
      ? {
          id: row.id,
          label: row.label,
          createdAt: row.created_at,
          branch: row.branch,
          tag: row.tag ?? undefined,
          parent: row.parent_id ?? undefined,
          doc: JSON.parse(row.doc),
        }
      : null;
  }

  /**
   * Restore a checkpoint: clear the profile's content, then re-import the blob — one
   * transaction (importProfileData's own transaction nests as a savepoint). The
   * profile row and its versions survive; only the content is replaced. Returns
   * false if the version doesn't exist for this profile.
   */
  restoreVersion(profileId, versionId) {
    const doc = this.getVersionDoc(profileId, versionId);
    if (!doc) return false;
    const tx = this.db.transaction(() => {
      this._resetProfileContent(profileId);
      this.importProfileData(profileId, doc);
    });
    tx();
    return true;
  }

  /**
   * Delete a profile's content while keeping the profile row. Deleting sections and
   * variants cascades to entries/items/*_tags/*_overrides and rules/sections/
   * letters/header (every child FK is ON DELETE CASCADE); the three flat
   * per-profile tables are cleared directly. profiles + versions are untouched.
   */
  _resetProfileContent(profileId) {
    this._stmts.clearSections.run(profileId);
    this._stmts.clearVariants.run(profileId);
    this._stmts.clearProfileSettings.run(profileId); // personal.* + coverletter.*
    this._stmts.clearTagAliases.run(profileId);
    this._stmts.clearTagCatalog.run(profileId);
  }
}

module.exports = Versions;
