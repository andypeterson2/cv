/**
 * ajv JSON Schema definitions for API request validation (normalized model).
 *
 * Each schema validates the request body for a write endpoint. Variants are
 * addressed by id and carry a `kind` (cv/resume/coverletter); content is shaped
 * per-variant via tags + overrides rather than a single resume_included flag.
 */

const Ajv = require('ajv');
const LATEX_UNITS = require('./latex-units');
const { VALID_SEMANTIC_TYPES } = require('./latex-type-map');

const ajv = new Ajv({ allErrors: true, removeAdditional: 'all', coerceTypes: false });

// Canonical constants shared with the MCP server (the @cv/constants package).
const { VARIANT_KINDS, SLUG_PATTERN, SCORER_METHODS } = require('@cv/constants');
const VALID_KINDS = VARIANT_KINDS;
const SLUG = SLUG_PATTERN;

// ---------------------------------------------------------------------------
// Global settings (style / spacing / fonts)
// ---------------------------------------------------------------------------

const settingsSchema = {
  type: 'object',
  patternProperties: {
    '^[a-zA-Z0-9_.]+$': {
      oneOf: [
        { type: 'string' },
        {
          type: 'object',
          properties: { num: { type: 'number' }, unit: { type: 'string', enum: LATEX_UNITS } },
          required: ['num', 'unit'],
          additionalProperties: false,
        },
      ],
    },
  },
  additionalProperties: false,
  minProperties: 1,
};

// ---------------------------------------------------------------------------
// Persons + personal info
// ---------------------------------------------------------------------------

const createPersonSchema = {
  type: 'object',
  properties: { name: { type: 'string', minLength: 1, maxLength: 200 } },
  required: ['name'],
  additionalProperties: false,
};

const updatePersonSchema = createPersonSchema;

const personalSchema = {
  type: 'object',
  patternProperties: { '^[a-zA-Z0-9_]+$': { type: 'string' } },
  additionalProperties: false,
  minProperties: 1,
};

// Cover-letter header fields (coverletter.*): same shape as personal — flat
// string map, the setter adds the prefix.
const coverletterSchema = {
  type: 'object',
  patternProperties: { '^[a-zA-Z0-9_]+$': { type: 'string' } },
  additionalProperties: false,
  minProperties: 1,
};

// Import is intentionally permissive: accepts both the new export shape
// ({personal, sections, variants, ...}) and the legacy shape ({personal,
// sections, documents, coverletter}).
const importSchema = { type: 'object', minProperties: 1 };

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

const createSectionSchema = {
  type: 'object',
  properties: {
    slug: { type: 'string', minLength: 1, maxLength: 100, pattern: SLUG },
    type: { type: 'string', enum: VALID_SEMANTIC_TYPES },
    title: { type: 'string', maxLength: 200 },
  },
  required: ['slug', 'type', 'title'],
  additionalProperties: false,
};

const updateSectionSchema = {
  type: 'object',
  properties: {
    slug: { type: 'string', minLength: 1, maxLength: 100, pattern: SLUG },
    type: { type: 'string', enum: VALID_SEMANTIC_TYPES },
    title: { type: 'string', maxLength: 200 },
  },
  minProperties: 1,
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// Entries + items
// ---------------------------------------------------------------------------

const entryFieldsSchema = {
  type: 'object',
  patternProperties: { '^[a-zA-Z0-9_]+$': { type: 'string' } },
  additionalProperties: false,
};

const createEntrySchema = {
  type: 'object',
  properties: { fields: entryFieldsSchema },
  required: ['fields'],
  additionalProperties: false,
};

const updateEntrySchema = {
  type: 'object',
  properties: { fields: entryFieldsSchema },
  required: ['fields'],
  additionalProperties: false,
};

const createItemSchema = {
  type: 'object',
  properties: { content: { type: 'string' }, title: { type: 'string' } },
  required: ['content'],
  additionalProperties: false,
};

const updateItemSchema = {
  type: 'object',
  properties: { content: { type: 'string' }, title: { type: 'string' } },
  minProperties: 1,
  additionalProperties: false,
};

const reorderSchema = {
  type: 'object',
  properties: {
    ids: { type: 'array', items: { type: 'integer', minimum: 1 }, minItems: 1, uniqueItems: true },
  },
  required: ['ids'],
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

const addTagsSchema = {
  type: 'object',
  properties: {
    tags: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 60 }, minItems: 1 },
  },
  required: ['tags'],
  additionalProperties: false,
};

const setTagAliasSchema = {
  type: 'object',
  properties: {
    alias: { type: 'string', minLength: 1, maxLength: 60 },
    canonical: { type: 'string', minLength: 1, maxLength: 60 },
  },
  required: ['alias', 'canonical'],
  additionalProperties: false,
};

// Author-time fuzzy expansion of a variant's include rules. Both fields optional.
const expandRulesSchema = {
  type: 'object',
  properties: {
    threshold: { type: 'number', minimum: 0, maximum: 1 },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
  },
  additionalProperties: false,
};

// Tag catalog (controlled vocabulary) upsert.
const setCatalogTagSchema = {
  type: 'object',
  properties: {
    tag: { type: 'string', minLength: 1, maxLength: 60 },
    description: { type: 'string', maxLength: 200 },
    category: { type: 'string', maxLength: 60 },
  },
  required: ['tag'],
  additionalProperties: false,
};

// Suggest tags for a piece of free text (bullet/entry content).
const suggestTagsSchema = {
  type: 'object',
  properties: {
    text: { type: 'string', minLength: 1, maxLength: 5000 },
    limit: { type: 'integer', minimum: 1, maximum: 50 },
    minScore: { type: 'number', minimum: 0, maximum: 1 },
    scorer: { type: 'string', enum: SCORER_METHODS },
  },
  required: ['text'],
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

const createVariantSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 200 },
    kind: { type: 'string', enum: VALID_KINDS },
  },
  required: ['name', 'kind'],
  additionalProperties: false,
};

const updateVariantSchema = {
  type: 'object',
  properties: { name: { type: 'string', minLength: 1, maxLength: 200 } },
  required: ['name'],
  additionalProperties: false,
};

const tagList = { type: 'array', items: { type: 'string', minLength: 1, maxLength: 60 } };

const variantRulesSchema = {
  type: 'object',
  properties: { include: tagList, exclude: tagList },
  additionalProperties: false,
};

const variantSectionsSchema = {
  type: 'object',
  properties: {
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          sectionId: { type: 'integer', minimum: 1 },
          enabled: { type: 'boolean' },
          sortOrder: { type: 'integer' },
        },
        required: ['sectionId'],
        additionalProperties: false,
      },
    },
  },
  required: ['sections'],
  additionalProperties: false,
};

const variantOverrideSchema = {
  type: 'object',
  properties: {
    targetType: { type: 'string', enum: ['entry', 'item'] },
    targetId: { type: 'integer', minimum: 1 },
    included: { type: ['boolean', 'null'] },
    textOverride: { type: ['string', 'null'] },
    sortOverride: { type: ['integer', 'null'] },
  },
  required: ['targetType', 'targetId'],
  additionalProperties: false,
};

const createLetterSectionSchema = {
  type: 'object',
  properties: { title: { type: 'string', maxLength: 200 }, body: { type: 'string' } },
  required: ['title', 'body'],
  additionalProperties: false,
};

const updateLetterSectionSchema = {
  type: 'object',
  properties: { title: { type: 'string', maxLength: 200 }, body: { type: 'string' } },
  minProperties: 1,
  additionalProperties: false,
};

const letterHeaderSchema = {
  type: 'object',
  properties: {
    recipientName: { type: 'string' },
    recipientAddress: { type: 'string' },
    opening: { type: 'string' },
    closing: { type: 'string' },
  },
  minProperties: 1,
  additionalProperties: false,
};

// ---------------------------------------------------------------------------

const schemas = {
  settings: settingsSchema,
  createPerson: createPersonSchema,
  updatePerson: updatePersonSchema,
  personal: personalSchema,
  coverletter: coverletterSchema,
  import: importSchema,
  createSection: createSectionSchema,
  updateSection: updateSectionSchema,
  createEntry: createEntrySchema,
  updateEntry: updateEntrySchema,
  createItem: createItemSchema,
  updateItem: updateItemSchema,
  reorder: reorderSchema,
  addTags: addTagsSchema,
  setTagAlias: setTagAliasSchema,
  expandRules: expandRulesSchema,
  setCatalogTag: setCatalogTagSchema,
  suggestTags: suggestTagsSchema,
  createVariant: createVariantSchema,
  updateVariant: updateVariantSchema,
  variantRules: variantRulesSchema,
  variantSections: variantSectionsSchema,
  variantOverride: variantOverrideSchema,
  createLetterSection: createLetterSectionSchema,
  updateLetterSection: updateLetterSectionSchema,
  letterHeader: letterHeaderSchema,
};

const validators = {};
for (const [name, schema] of Object.entries(schemas)) validators[name] = ajv.compile(schema);

/**
 * Express middleware factory: validates req.body against a named schema.
 */
function validate(schemaName) {
  const validator = validators[schemaName];
  if (!validator) throw new Error(`Unknown schema: ${schemaName}`);
  return (req, res, next) => {
    if (validator(req.body)) {
      next();
    } else {
      res.status(400).json({ error: 'Validation failed', details: validator.errors });
    }
  };
}

/** A variant kind is one of cv / resume / coverletter. */
function isValidKind(kind) {
  return VALID_KINDS.includes(kind);
}

module.exports = {
  validators,
  validate,
  isValidKind,
  VALID_KINDS,
  schemas,
};
