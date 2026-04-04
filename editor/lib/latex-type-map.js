/**
 * Maps semantic section types to their LaTeX environment names.
 * Single source of truth for the semantic → LaTeX type relationship.
 */

// Semantic → LaTeX (primary, used everywhere)
const LATEX_TYPE_MAP = {
  experience: 'cventries',
  education: 'cventries',
  projects: 'cventries',
  presentations: 'cventries',
  leadership: 'cventries',
  volunteer: 'cventries',
  committees: 'cventries',
  extracurricular: 'cventries',
  writing: 'cventries',
  skills: 'cvskills',
  honors: 'cvhonors',
  certifications: 'cvhonors',
  summary: 'cvparagraph',
  references: 'cvreferences',
};

// LaTeX → default semantic (used only during migration + import)
const LEGACY_TYPE_MAP = {
  cventries: 'experience',
  cvskills: 'skills',
  cvhonors: 'honors',
  cvparagraph: 'summary',
  cvreferences: 'references',
};

const VALID_SEMANTIC_TYPES = Object.keys(LATEX_TYPE_MAP);

/**
 * Resolve a semantic type to its LaTeX environment name.
 * Falls through to identity for unknown types — safe for transition.
 */
function getLatexType(semanticType) {
  return LATEX_TYPE_MAP[semanticType] || semanticType;
}

/**
 * Normalize a type value to semantic form.
 * Accepts both semantic and legacy LaTeX type names.
 * Used during import and migration.
 */
function normalizeType(type) {
  if (LATEX_TYPE_MAP[type]) return type; // already semantic
  return LEGACY_TYPE_MAP[type] || type;  // convert legacy, or pass through
}

/**
 * Backend-relevant metadata for semantic types.
 * Combine rules merge split fields into a single LaTeX field during generation.
 */
const SECTION_TYPE_MAP = {
  education: {
    combine: { target: 'position', from: ['program', 'major'], join: ' ' },
  },
};

module.exports = { LATEX_TYPE_MAP, LEGACY_TYPE_MAP, SECTION_TYPE_MAP, VALID_SEMANTIC_TYPES, getLatexType, normalizeType };
