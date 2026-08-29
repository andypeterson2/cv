/**
 * AJV schema for a layout bundle manifest (layout.json). Reused by the
 * verification harness (static checks). `ajv` is already an app dependency.
 */
const Ajv = require('ajv');
const { SLUG_PATTERN, VARIANT_KINDS } = require('@cv/constants');

const ajv = new Ajv({ allErrors: true });

const schema = {
  type: 'object',
  required: ['id', 'engine', 'kinds', 'entry'],
  properties: {
    id: { type: 'string', pattern: SLUG_PATTERN },
    name: { type: 'string' },
    version: { type: 'string' },
    description: { type: 'string' },
    author: { type: 'string' },
    engine: { type: 'string', enum: ['nunjucks'] },
    contextVersion: { type: 'integer', minimum: 1 },
    kinds: { type: 'array', minItems: 1, items: { type: 'string', enum: VARIANT_KINDS } },
    entry: {
      type: 'object',
      properties: { document: { type: 'string' }, coverletter: { type: 'string' } },
      additionalProperties: false,
    },
    main: { type: 'string' },
    classFiles: { type: 'array', items: { type: 'string' } },
    options: {},
  },
  additionalProperties: true,
};

const validateFn = ajv.compile(schema);

/** @returns {{ ok: boolean, errors: string[] }} */
function validateManifest(manifest) {
  const ok = validateFn(manifest);
  const errors = ok
    ? []
    : (validateFn.errors || []).map((e) => `${e.instancePath || '/'} ${e.message}`);
  return { ok, errors };
}

module.exports = { validateManifest };
