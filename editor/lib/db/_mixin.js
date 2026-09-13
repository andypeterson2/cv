/**
 * Copy a mixin class's prototype methods onto a target class's prototype, so
 * CvDatabase can be composed from focused method modules written as plain
 * classes. Methods move verbatim (no object-literal commas) and run with
 * `this` === the CvDatabase instance, so they share its prepared statements + db.
 */
function applyMixin(TargetClass, MixinClass) {
  for (const name of Object.getOwnPropertyNames(MixinClass.prototype)) {
    if (name === 'constructor') continue;
    Object.defineProperty(
      TargetClass.prototype,
      name,
      Object.getOwnPropertyDescriptor(MixinClass.prototype, name),
    );
  }
}

module.exports = { applyMixin };
