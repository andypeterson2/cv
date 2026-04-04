/**
 * ajv JSON Schema definitions for API request validation.
 *
 * Each schema validates the request body for a specific write endpoint.
 * Exported as compiled validator functions via ajv.compile().
 */

const Ajv = require('ajv');
const LATEX_UNITS = require('./latex-units');

const ajv = new Ajv({ allErrors: true, removeAdditional: 'all', coerceTypes: false });

// Canonical list — keep in sync with public/cv/section-types.js
const { VALID_SEMANTIC_TYPES } = require('./latex-type-map');
const VALID_SECTION_TYPES = VALID_SEMANTIC_TYPES;

const VALID_VARIANTS = ['cv', 'resume', 'coverletter'];

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const settingsSchema = {
  type: 'object',
  patternProperties: {
    '^[a-zA-Z0-9_.]+$': {
      oneOf: [
        { type: 'string' },
        {
          type: 'object',
          properties: {
            num: { type: 'number' },
            unit: { type: 'string', enum: LATEX_UNITS },
          },
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
// Sections
// ---------------------------------------------------------------------------

const createSectionSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 100, pattern: '^[a-z0-9_-]+$' },
    type: {
      type: 'string',
      enum: VALID_SECTION_TYPES,
    },
    title: { type: 'string', maxLength: 200 },
  },
  required: ['id', 'type', 'title'],
  additionalProperties: false,
};

const updateSectionSchema = {
  type: 'object',
  properties: {
    title: { type: 'string', maxLength: 200 },
  },
  required: ['title'],
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

const entryFieldsSchema = {
  type: 'object',
  patternProperties: {
    '^[a-zA-Z0-9_]+$': { type: 'string' },
  },
  additionalProperties: false,
};

const createEntrySchema = {
  type: 'object',
  properties: {
    fields: entryFieldsSchema,
  },
  required: ['fields'],
  additionalProperties: false,
};

const updateEntrySchema = {
  type: 'object',
  properties: {
    fields: entryFieldsSchema,
    resumeIncluded: { type: 'boolean' },
  },
  minProperties: 1,
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// Items (bullet points)
// ---------------------------------------------------------------------------

const createItemSchema = {
  type: 'object',
  properties: {
    content: { type: 'string' },
    title: { type: 'string' },
  },
  required: ['content'],
  additionalProperties: false,
};

const updateItemSchema = {
  type: 'object',
  properties: {
    content: { type: 'string' },
    resumeIncluded: { type: 'boolean' },
    title: { type: 'string' },
  },
  minProperties: 1,
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// Reorder (shared schema for entries, items, coverletter sections)
// ---------------------------------------------------------------------------

const reorderSchema = {
  type: 'object',
  properties: {
    ids: {
      type: 'array',
      items: { type: 'integer', minimum: 1 },
      minItems: 1,
      uniqueItems: true,
    },
  },
  required: ['ids'],
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// Document sections
// ---------------------------------------------------------------------------

const documentSectionsSchema = {
  type: 'object',
  properties: {
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          sectionId: { type: 'string', minLength: 1 },
          enabled: { type: 'boolean' },
          resumeParagraphText: { type: ['string', 'null'] },
        },
        required: ['sectionId'],
        additionalProperties: false,
      },
    },
  },
  required: ['sections'],
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// Cover letter sections
// ---------------------------------------------------------------------------

const createCoverletterSectionSchema = {
  type: 'object',
  properties: {
    title: { type: 'string', maxLength: 200 },
    body: { type: 'string' },
  },
  required: ['title', 'body'],
  additionalProperties: false,
};

const updateCoverletterSectionSchema = {
  type: 'object',
  properties: {
    title: { type: 'string', maxLength: 200 },
    body: { type: 'string' },
  },
  minProperties: 1,
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// Compile
// ---------------------------------------------------------------------------

const variantSchema = {
  type: 'string',
  enum: VALID_VARIANTS,
};

// ---------------------------------------------------------------------------
// Persons
// ---------------------------------------------------------------------------

const createPersonSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 200 },
  },
  required: ['name'],
  additionalProperties: false,
};

const updatePersonSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 200 },
  },
  required: ['name'],
  additionalProperties: false,
};

const importDataSchema = {
  type: 'object',
  properties: {
    personal: { type: 'object' },
    sections: { type: 'array' },
    documents: { type: 'object' },
    coverletter: { type: 'object' },
  },
  required: ['personal', 'sections'],
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// Compile and export validators
// ---------------------------------------------------------------------------

const validators = {
  settings: ajv.compile(settingsSchema),
  createSection: ajv.compile(createSectionSchema),
  updateSection: ajv.compile(updateSectionSchema),
  createEntry: ajv.compile(createEntrySchema),
  updateEntry: ajv.compile(updateEntrySchema),
  createItem: ajv.compile(createItemSchema),
  updateItem: ajv.compile(updateItemSchema),
  reorder: ajv.compile(reorderSchema),
  documentSections: ajv.compile(documentSectionsSchema),
  createCoverletterSection: ajv.compile(createCoverletterSectionSchema),
  updateCoverletterSection: ajv.compile(updateCoverletterSectionSchema),
  createPerson: ajv.compile(createPersonSchema),
  updatePerson: ajv.compile(updatePersonSchema),
  importData: ajv.compile(importDataSchema),
};

/**
 * Express middleware factory. Returns a middleware that validates req.body
 * against the named schema. Responds 400 with errors on failure.
 */
function validate(schemaName) {
  const validator = validators[schemaName];
  if (!validator) throw new Error(`Unknown schema: ${schemaName}`);
  return (req, res, next) => {
    if (validator(req.body)) {
      next();
    } else {
      res.status(400).json({
        error: 'Validation failed',
        details: validator.errors,
      });
    }
  };
}

/**
 * Check if a variant string is valid.
 */
function isValidVariant(variant) {
  return VALID_VARIANTS.includes(variant);
}

module.exports = {
  validators,
  validate,
  isValidVariant,
  VALID_VARIANTS,
  // Export raw schemas for testing
  schemas: {
    settings: settingsSchema,
    createSection: createSectionSchema,
    updateSection: updateSectionSchema,
    createEntry: createEntrySchema,
    updateEntry: updateEntrySchema,
    createItem: createItemSchema,
    updateItem: updateItemSchema,
    reorder: reorderSchema,
    documentSections: documentSectionsSchema,
    createCoverletterSection: createCoverletterSectionSchema,
    updateCoverletterSection: updateCoverletterSectionSchema,
    createPerson: createPersonSchema,
    updatePerson: updatePersonSchema,
    importData: importDataSchema,
  },
};
