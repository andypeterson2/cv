/**
 * Settings methods for CvDatabase, mixed onto the prototype. Style/spacing/fonts are
 * per-user in `settings`; personal info is per-profile in `profile_settings`; the
 * cover-letter header is per-variant. Methods run with `this` === the CvDatabase
 * instance, so they use its prepared statements + db.
 *
 * An account with no rows of its own reads back nothing, and the render context fills
 * every missing key from STYLE_DEFAULTS. There is no shared tier underneath.
 */
const { rowsToSettings, stripPrefix } = require('./helpers');

module.exports = {
  // Per-user settings (style / spacing / fonts)
  getSettings(prefix, userId) {
    const rows = this._stmts.getSettings.all(userId ?? null, prefix ? prefix + '.' : '');
    return rowsToSettings(rows);
  },

  setSettings(map, userId) {
    const tx = this.db.transaction((entries) => {
      for (const [key, val] of entries) {
        if (val == null) {
          this._stmts.deleteSetting.run(userId, key);
        } else if (typeof val === 'object' && 'num' in val && 'unit' in val) {
          this._stmts.upsertSettingUnit.run(
            userId,
            key,
            String(val.num) + val.unit,
            val.num,
            val.unit,
          );
        } else {
          this._stmts.upsertSetting.run(userId, key, val);
        }
      }
    });
    tx(Object.entries(map));
  },

  // Profile settings (personal.* / coverletter.*)
  getProfileSettings(profileId, prefix) {
    const rows = this._stmts.getProfileSettings.all(profileId, prefix ? prefix + '.' : '');
    return rowsToSettings(rows);
  },

  setProfileSettings(profileId, map) {
    const tx = this.db.transaction(() => {
      for (const [key, val] of Object.entries(map)) {
        this._stmts.upsertProfileSetting.run(profileId, key, val == null ? null : String(val));
      }
    });
    tx();
  },

  /** personal.* settings → flat object with the prefix stripped. */
  getPersonal(profileId) {
    return stripPrefix(this.getProfileSettings(profileId, 'personal'), 'personal.');
  },

  setPersonal(profileId, fields) {
    const map = {};
    for (const [k, v] of Object.entries(fields)) map['personal.' + k] = v;
    this.setProfileSettings(profileId, map);
  },
};
