/**
 * Settings methods for CvDatabase, mixed onto the prototype (Object.assign in
 * db.js). Global style/spacing/fonts live in `settings`; personal info and the
 * cover-letter header are per-person in `person_settings`. Methods run with
 * `this` === the CvDatabase instance, so they use its prepared statements + db.
 */
const { rowsToSettings, stripPrefix } = require('./helpers');

module.exports = {
  // ---- Global settings (style / spacing / fonts) ----
  getSettings(prefix) {
    const rows = this._stmts.getSettings.all(prefix ? prefix + '.' : '');
    return rowsToSettings(rows);
  },

  setSettings(map) {
    const tx = this.db.transaction((entries) => {
      for (const [key, val] of entries) {
        if (val && typeof val === 'object' && 'num' in val && 'unit' in val) {
          this._stmts.upsertSettingUnit.run(key, String(val.num) + val.unit, val.num, val.unit);
        } else {
          this._stmts.upsertSetting.run(key, val);
        }
      }
    });
    tx(Object.entries(map));
  },

  // ---- Person settings (personal.* / coverletter.*) ----
  getPersonSettings(personId, prefix) {
    const rows = this._stmts.getPersonSettings.all(personId, prefix ? prefix + '.' : '');
    return rowsToSettings(rows);
  },

  setPersonSettings(personId, map) {
    const tx = this.db.transaction(() => {
      for (const [key, val] of Object.entries(map)) {
        this._stmts.upsertPersonSetting.run(personId, key, val == null ? null : String(val));
      }
    });
    tx();
  },

  /** personal.* settings → flat object with the prefix stripped. */
  getPersonal(personId) {
    return stripPrefix(this.getPersonSettings(personId, 'personal'), 'personal.');
  },

  setPersonal(personId, fields) {
    const map = {};
    for (const [k, v] of Object.entries(fields)) map['personal.' + k] = v;
    this.setPersonSettings(personId, map);
  },
  // The cover-letter header is per-variant now (variant_letter_header, design #14),
  // no longer a `coverletter.*` person setting — see db/variants.js.
};
