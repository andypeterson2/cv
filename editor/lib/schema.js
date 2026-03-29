/**
 * ajv JSON Schema definitions for API request validation.
 *
 * Each schema validates the request body for a specific write endpoint.
 * Exported as compiled validator functions via ajv.compile().
 */

const Ajv = require('ajv');

const ajv = new Ajv({ allErrors: true, removeAdditional: 'all', coerceTypes: false });

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const settingsSchema = {
  type: 'object',
  patternProperties: {
    '^[a-zA-Z0-9_.]+$': { type: 'string' },
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
      enum: ['cventries', 'cvskills', 'cvhonors', 'cvreferences', 'cvparagraph'],
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

const createEntrySchema = {
  type: 'object',
  properties: {
    fields: { type: 'object' },
  },
  required: ['fields'],
  additionalProperties: false,
};

const updateEntrySchema = {
  type: 'object',
  properties: {
    fields: { type: 'object' },
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
  },
  required: ['content'],
  additionalProperties: false,
};

const updateItemSchema = {
  type: 'object',
  properties: {
    content: { type: 'string' },
    resumeIncluded: { type: 'boolean' },
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
// Metrics
// ---------------------------------------------------------------------------

const createMetricSchema = {
  type: 'object',
  properties: {
    command: { type: 'string', minLength: 1, maxLength: 100, pattern: '^[a-zA-Z]+$' },
    label: { type: 'string', maxLength: 200 },
    value: { type: ['string', 'null'], maxLength: 200 },
    groupName: { type: 'string', maxLength: 200 },
    sectionId: { type: 'string', minLength: 1 },
  },
  required: ['command', 'sectionId'],
  additionalProperties: false,
};

const updateMetricSchema = {
  type: 'object',
  properties: {
    command: { type: 'string', minLength: 1, maxLength: 100, pattern: '^[a-zA-Z]+$' },
    label: { type: 'string', maxLength: 200 },
    value: { type: ['string', 'null'], maxLength: 200 },
    groupName: { type: 'string', maxLength: 200 },
  },
  minProperties: 1,
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
  enum: ['cv', 'resume', 'coverletter'],
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
    metrics: { type: 'array' },
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
  createMetric: ajv.compile(createMetricSchema),
  updateMetric: ajv.compile(updateMetricSchema),
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
  return ['cv', 'resume', 'coverletter'].includes(variant);
}

module.exports = {
  validators,
  validate,
  isValidVariant,
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
    createMetric: createMetricSchema,
    updateMetric: updateMetricSchema,
    documentSections: documentSectionsSchema,
    createCoverletterSection: createCoverletterSectionSchema,
    updateCoverletterSection: updateCoverletterSectionSchema,
    createPerson: createPersonSchema,
    updatePerson: updatePersonSchema,
    importData: importDataSchema,
  },
};
