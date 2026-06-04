#!/usr/bin/env node
/**
 * MCP server for the CV editor REST API (normalized, stateless model).
 *
 * Every tool is id-addressable — there is no "active person" and no switch.
 * Read a person's master once (cv_get_master), edit by id, tag content, define
 * variants by tag rules + overrides, preview with cv_resolve_variant, and
 * render any variant with cv_get_pdf. Ids are stable, so an id you read is a
 * valid id to write.
 *
 * Configuration:
 *   CV_EDITOR_URL  — base URL of the running cv-editor (default
 *                    http://localhost:3001)
 *   CV_EDITOR_AUTH — optional Authorization header value sent with every request,
 *                    for deployments behind a reverse proxy that requires auth,
 *                    e.g. "Basic <base64(user:pass)>" or "Bearer <token>".
 *   CV_MCP_PDF_DIR — directory where compiled PDFs are saved (default
 *                    $TMPDIR/cv-mcp-pdfs)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import shared from '../shared/constants.js'; // canonical enums/patterns (CJS interop)

const BASE_URL = (process.env.CV_EDITOR_URL || 'http://localhost:3001').replace(/\/$/, '');
const AUTH = process.env.CV_EDITOR_AUTH; // e.g. "Basic <base64>" when behind an auth proxy
const PDF_DIR = process.env.CV_MCP_PDF_DIR || join(tmpdir(), 'cv-mcp-pdfs');

const enc = encodeURIComponent;

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

async function api(method, path, body, { expectBinary = false } = {}) {
  let res;
  try {
    res = await fetch(BASE_URL + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(AUTH ? { Authorization: AUTH } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error(
      `Could not reach cv-editor at ${BASE_URL}: ${e.message}. ` +
      `Make sure the cv-editor server is running.`
    );
  }

  const ct = res.headers.get('content-type') || '';
  if (expectBinary && res.ok) return await res.arrayBuffer();

  if (ct.includes('application/json')) {
    const data = await res.json();
    if (!res.ok) {
      const detail = data && (data.error || data.message) ? `: ${data.error || data.message}` : '';
      throw new Error(`HTTP ${res.status} ${method} ${path}${detail}`);
    }
    return data;
  }
  const text = (await res.text()).slice(0, 200);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${method} ${path}: ${text}`);
  return text;
}

// ---------------------------------------------------------------------------
// Tool catalog
// ---------------------------------------------------------------------------

const personId = { type: 'integer', description: 'Person id (from cv_list_persons)' };
const variantId = { type: 'integer', description: 'Variant id (from cv_list_variants / cv_get_master)' };
const tagList = { type: 'array', items: { type: 'string' }, description: 'Tag names (free strings)' };

const toolDefs = [
  {
    name: 'cv_health',
    description: 'Ping the cv-editor backend. Returns {status, service, persons}. Call first if other tools error.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: () => api('GET', '/api/health'),
  },
  {
    name: 'cv_list_persons',
    description: 'List every profile: {persons:[{id,name,created_at}]}. Always safe. Use ids with cv_get_master etc.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: () => api('GET', '/api/persons'),
  },
  {
    name: 'cv_get_master',
    description:
      'Return a person\'s FULL master CV with stable ids: {person, personal, coverletter, ' +
      'sections:[{id,slug,type,title,sortOrder,entries:[{id,fields,tags,items:[{id,content,title,tags}]}]}], ' +
      'variants:[{id,name,kind,rules,sections}], tags, tagAliases}. Read this once, then edit by id. This is the ' +
      'canonical read — ids here are valid for every edit/tag/override tool.',
    inputSchema: { type: 'object', properties: { person_id: personId }, required: ['person_id'], additionalProperties: false },
    handler: (a) => api('GET', `/api/persons/${enc(a.person_id)}`),
  },
  {
    name: 'cv_create_person',
    description: 'Create a new empty profile. Returns {id}.',
    inputSchema: { type: 'object', properties: { name: { type: 'string', minLength: 1, maxLength: 200 } }, required: ['name'], additionalProperties: false },
    handler: (a) => api('POST', '/api/persons', { name: a.name }),
  },
  {
    name: 'cv_delete_person',
    description: 'Delete a profile and ALL its content and variants.',
    inputSchema: { type: 'object', properties: { person_id: personId }, required: ['person_id'], additionalProperties: false },
    handler: (a) => api('DELETE', `/api/persons/${enc(a.person_id)}`),
  },
  {
    name: 'cv_set_personal',
    description: 'Update personal info fields (firstName, lastName, position, email, github, …). Only passed fields change; all values must be strings.',
    inputSchema: {
      type: 'object',
      properties: { person_id: personId, fields: { type: 'object', description: 'field → string value', minProperties: 1 } },
      required: ['person_id', 'fields'],
      additionalProperties: false,
    },
    handler: (a) => {
      for (const [k, v] of Object.entries(a.fields)) {
        if (typeof v !== 'string') throw new Error(`Personal field "${k}" must be a string, got ${typeof v}`);
      }
      return api('PATCH', `/api/persons/${enc(a.person_id)}/personal`, a.fields);
    },
  },
  // ---- Sections / entries / bullets (master content) ----
  {
    name: 'cv_add_section',
    description: 'Add a section to a person. slug is kebab-case (unique per person). type: experience, education, projects, skills, certifications, references, summary, honors, writing, … Returns {id}.',
    inputSchema: {
      type: 'object',
      properties: { person_id: personId, slug: { type: 'string', pattern: shared.SLUG_PATTERN }, type: { type: 'string' }, title: { type: 'string' } },
      required: ['person_id', 'slug', 'type', 'title'],
      additionalProperties: false,
    },
    handler: (a) => api('POST', `/api/persons/${enc(a.person_id)}/sections`, { slug: a.slug, type: a.type, title: a.title }),
  },
  {
    name: 'cv_update_section',
    description: 'Update a section\'s title (and optionally slug/type). Pass at least one of slug, type, title.',
    inputSchema: {
      type: 'object',
      properties: { section_id: { type: 'integer' }, slug: { type: 'string', pattern: shared.SLUG_PATTERN }, type: { type: 'string' }, title: { type: 'string' } },
      required: ['section_id'],
      additionalProperties: false,
    },
    handler: (a) => {
      const body = {};
      for (const k of ['slug', 'type', 'title']) if (a[k] !== undefined) body[k] = a[k];
      if (!Object.keys(body).length) throw new Error('cv_update_section needs at least one of: slug, type, title');
      return api('PUT', `/api/sections/${enc(a.section_id)}`, body);
    },
  },
  {
    name: 'cv_delete_section',
    description: 'Delete a section and all its entries/bullets.',
    inputSchema: { type: 'object', properties: { section_id: { type: 'integer' } }, required: ['section_id'], additionalProperties: false },
    handler: (a) => api('DELETE', `/api/sections/${enc(a.section_id)}`),
  },
  {
    name: 'cv_add_entry',
    description:
      'Add an entry to a section. fields are type-specific: experience/projects {position, organization, location, date}; ' +
      'education {position, organization, location, date, program, major}; skills {category, skills}; ' +
      'certifications {award, issuer, location, date}; summary {text}. All values strings. Returns {id}.',
    inputSchema: {
      type: 'object',
      properties: { section_id: { type: 'integer' }, fields: { type: 'object', minProperties: 1 } },
      required: ['section_id', 'fields'],
      additionalProperties: false,
    },
    handler: (a) => api('POST', `/api/sections/${enc(a.section_id)}/entries`, { fields: a.fields }),
  },
  {
    name: 'cv_update_entry',
    description: 'Replace an entry\'s fields.',
    inputSchema: { type: 'object', properties: { entry_id: { type: 'integer' }, fields: { type: 'object' } }, required: ['entry_id', 'fields'], additionalProperties: false },
    handler: (a) => api('PUT', `/api/entries/${enc(a.entry_id)}`, { fields: a.fields }),
  },
  {
    name: 'cv_delete_entry',
    description: 'Delete an entry and its bullets.',
    inputSchema: { type: 'object', properties: { entry_id: { type: 'integer' } }, required: ['entry_id'], additionalProperties: false },
    handler: (a) => api('DELETE', `/api/entries/${enc(a.entry_id)}`),
  },
  {
    name: 'cv_add_bullet',
    description:
      'Add a bullet to an entry. Returns {id}. After adding, tag it consistently: call cv_suggest_tags with the ' +
      'bullet text and apply the fitting existing tags via cv_tag.',
    inputSchema: { type: 'object', properties: { entry_id: { type: 'integer' }, content: { type: 'string' }, title: { type: 'string' } }, required: ['entry_id', 'content'], additionalProperties: false },
    handler: (a) => api('POST', `/api/entries/${enc(a.entry_id)}/items`, { content: a.content, ...(a.title !== undefined ? { title: a.title } : {}) }),
  },
  {
    name: 'cv_update_bullet',
    description: 'Update a bullet\'s content and/or title. Pass at least one.',
    inputSchema: { type: 'object', properties: { item_id: { type: 'integer' }, content: { type: 'string' }, title: { type: 'string' } }, required: ['item_id'], additionalProperties: false },
    handler: (a) => {
      const body = {};
      if (a.content !== undefined) body.content = a.content;
      if (a.title !== undefined) body.title = a.title;
      if (!Object.keys(body).length) throw new Error('cv_update_bullet needs at least one of: content, title');
      return api('PUT', `/api/items/${enc(a.item_id)}`, body);
    },
  },
  {
    name: 'cv_delete_bullet',
    description: 'Delete a bullet.',
    inputSchema: { type: 'object', properties: { item_id: { type: 'integer' } }, required: ['item_id'], additionalProperties: false },
    handler: (a) => api('DELETE', `/api/items/${enc(a.item_id)}`),
  },
  // ---- Tags ----
  {
    name: 'cv_tag',
    description:
      'Add one or more tags to an entry or bullet. Tags drive variant inclusion and are matched exactly (after ' +
      'case/separator normalization + alias folding). target: "entry" or "bullet". To choose tags for a new or ' +
      'edited bullet/entry, call cv_suggest_tags with its TEXT first and apply the fitting existing tags; only coin ' +
      'a new tag (and promote it with cv_add_catalog_tag) when nothing suggested fits. Keeps the vocabulary consistent.',
    inputSchema: {
      type: 'object',
      properties: { target: { type: 'string', enum: ['entry', 'bullet'] }, id: { type: 'integer' }, tags: tagList },
      required: ['target', 'id', 'tags'],
      additionalProperties: false,
    },
    handler: (a) => api('POST', `/api/${a.target === 'bullet' ? 'items' : 'entries'}/${enc(a.id)}/tags`, { tags: a.tags }),
  },
  {
    name: 'cv_untag',
    description: 'Remove a single tag from an entry or bullet. target: "entry" or "bullet".',
    inputSchema: {
      type: 'object',
      properties: { target: { type: 'string', enum: ['entry', 'bullet'] }, id: { type: 'integer' }, tag: { type: 'string' } },
      required: ['target', 'id', 'tag'],
      additionalProperties: false,
    },
    handler: (a) => api('DELETE', `/api/${a.target === 'bullet' ? 'items' : 'entries'}/${enc(a.id)}/tags/${enc(a.tag)}`),
  },
  {
    name: 'cv_search_tags',
    description:
      'Fuzzy-search a person\'s existing tag vocabulary — tolerant of typos, case/separator variants, prefixes, and ' +
      'aliases. Returns {query, results:[{tag, score, count, via}]} ranked best-first (score in 0..1). Call this ' +
      'BEFORE coining a new tag and reuse a close existing one (score ~0.7+) so the vocabulary does not fragment, and ' +
      'before writing variant rules to find the exact tags to include. Approximate — never auto-applied to a render.',
    inputSchema: {
      type: 'object',
      properties: {
        person_id: personId,
        q: { type: 'string', minLength: 1, description: 'Search text' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Max results (default 10)' },
        min_score: { type: 'number', minimum: 0, maximum: 1, description: 'Score floor (default 0.3)' },
      },
      required: ['person_id', 'q'],
      additionalProperties: false,
    },
    handler: (a) => {
      const qs = [`q=${enc(a.q)}`];
      if (a.limit !== undefined) qs.push(`limit=${enc(a.limit)}`);
      if (a.min_score !== undefined) qs.push(`min_score=${enc(a.min_score)}`);
      return api('GET', `/api/persons/${enc(a.person_id)}/tags/search?${qs.join('&')}`);
    },
  },
  {
    name: 'cv_alias_tag',
    description:
      'Define a tag alias (alias → canonical), e.g. "ml" → "machine-learning" or "js" → "javascript". Bridges true ' +
      'synonyms that fuzzy matching cannot. Once set, tagging or writing a rule with the alias stores the canonical ' +
      'instead, and existing uses of the alias are folded into the canonical — the vocabulary converges. Rejects ' +
      'self-aliases and cycles (409).',
    inputSchema: {
      type: 'object',
      properties: { person_id: personId, alias: { type: 'string', minLength: 1 }, canonical: { type: 'string', minLength: 1 } },
      required: ['person_id', 'alias', 'canonical'],
      additionalProperties: false,
    },
    handler: (a) => api('PUT', `/api/persons/${enc(a.person_id)}/tag-aliases`, { alias: a.alias, canonical: a.canonical }),
  },
  {
    name: 'cv_unalias_tag',
    description: 'Remove a tag alias. Tags already folded into the canonical are left as-is.',
    inputSchema: {
      type: 'object',
      properties: { person_id: personId, alias: { type: 'string', minLength: 1 } },
      required: ['person_id', 'alias'],
      additionalProperties: false,
    },
    handler: (a) => api('DELETE', `/api/persons/${enc(a.person_id)}/tag-aliases/${enc(a.alias)}`),
  },
  {
    name: 'cv_suggest_tags',
    description:
      'Given a piece of bullet/entry TEXT, return EXISTING tags that fit it, ranked best-first, drawn from the ' +
      'person\'s tag catalog (controlled vocabulary) + current usage vocabulary: {query, results:[{tag, score, ' +
      'inCatalog, count, via}]}. This is the smart-tagging primitive — call it when adding or editing content, then ' +
      'apply the high-scoring existing tags with cv_tag instead of coining near-duplicates. Suggestions are ' +
      'candidates only; nothing is written until you call cv_tag. Prefer tags where inCatalog is true.',
    inputSchema: {
      type: 'object',
      properties: {
        person_id: personId,
        text: { type: 'string', minLength: 1, description: 'The bullet/entry text to tag' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Max suggestions (default 8)' },
        min_score: { type: 'number', minimum: 0, maximum: 1, description: 'Score floor (default 0.35)' },
        scorer: { type: 'string', enum: shared.SCORER_METHODS, description: 'Ranking method; lexical (default) needs no model. embedding is an optional local semantic scorer for bulk/offline use.' },
      },
      required: ['person_id', 'text'],
      additionalProperties: false,
    },
    handler: (a) => {
      const body = { text: a.text };
      if (a.limit !== undefined) body.limit = a.limit;
      if (a.min_score !== undefined) body.minScore = a.min_score;
      if (a.scorer !== undefined) body.scorer = a.scorer;
      return api('POST', `/api/persons/${enc(a.person_id)}/tags/suggest`, body);
    },
  },
  {
    name: 'cv_list_tag_catalog',
    description:
      'List the person\'s tag catalog — the curated controlled vocabulary: [{tag, description, category}]. This is ' +
      'the preferred target set for tagging; cv_suggest_tags ranks catalog members first.',
    inputSchema: { type: 'object', properties: { person_id: personId }, required: ['person_id'], additionalProperties: false },
    handler: (a) => api('GET', `/api/persons/${enc(a.person_id)}/tags/catalog`),
  },
  {
    name: 'cv_add_catalog_tag',
    description:
      'Add/define a canonical tag in the catalog (optional description + category like "skill"/"domain"/"role"). ' +
      'Use when a genuinely new concept appears that no existing or suggested tag covers — promoting it makes future ' +
      'content tag to it consistently. The tag is normalized + alias-folded before storing.',
    inputSchema: {
      type: 'object',
      properties: {
        person_id: personId,
        tag: { type: 'string', minLength: 1 },
        description: { type: 'string' },
        category: { type: 'string' },
      },
      required: ['person_id', 'tag'],
      additionalProperties: false,
    },
    handler: (a) => {
      const body = { tag: a.tag };
      if (a.description !== undefined) body.description = a.description;
      if (a.category !== undefined) body.category = a.category;
      return api('PUT', `/api/persons/${enc(a.person_id)}/tags/catalog`, body);
    },
  },
  {
    name: 'cv_remove_catalog_tag',
    description: 'Remove a tag from the catalog. Does not touch content already tagged with it.',
    inputSchema: {
      type: 'object',
      properties: { person_id: personId, tag: { type: 'string', minLength: 1 } },
      required: ['person_id', 'tag'],
      additionalProperties: false,
    },
    handler: (a) => api('DELETE', `/api/persons/${enc(a.person_id)}/tags/catalog/${enc(a.tag)}`),
  },
  {
    name: 'cv_seed_catalog',
    description:
      'Bootstrap the catalog by promoting all currently-used tags into it (one-time convenience; then prune/curate). ' +
      'Returns {added}.',
    inputSchema: { type: 'object', properties: { person_id: personId }, required: ['person_id'], additionalProperties: false },
    handler: (a) => api('POST', `/api/persons/${enc(a.person_id)}/tags/catalog/seed`),
  },
  {
    name: 'cv_suggest_tags_bulk',
    description:
      'Suggest tags for EVERY entry and bullet of a person in one call — use right after importing an untagged CV to ' +
      'tag the whole thing efficiently. Returns {count, items:[{target, id, text, current, suggestions:[…]}]}. ' +
      'Suggest-only: nothing is written. Review and apply the good ones with cv_tag. Pass scorer:"embedding" for ' +
      'local semantic ranking over many items without per-item frontier cost.',
    inputSchema: {
      type: 'object',
      properties: {
        person_id: personId,
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Max suggestions per item (default 5)' },
        min_score: { type: 'number', minimum: 0, maximum: 1, description: 'Score floor (default 0.4)' },
        scorer: { type: 'string', enum: shared.SCORER_METHODS },
      },
      required: ['person_id'],
      additionalProperties: false,
    },
    handler: (a) => {
      const body = {};
      if (a.limit !== undefined) body.limit = a.limit;
      if (a.min_score !== undefined) body.minScore = a.min_score;
      if (a.scorer !== undefined) body.scorer = a.scorer;
      return api('POST', `/api/persons/${enc(a.person_id)}/tags/suggest-bulk`, body);
    },
  },
  // ---- Variants ----
  {
    name: 'cv_list_variants',
    description: 'List a person\'s variants: [{id,name,kind,created_at}]. kind ∈ cv|resume|coverletter.',
    inputSchema: { type: 'object', properties: { person_id: personId }, required: ['person_id'], additionalProperties: false },
    handler: (a) => api('GET', `/api/persons/${enc(a.person_id)}/variants`),
  },
  {
    name: 'cv_get_variant',
    description: 'Return a variant\'s full config: {id,name,kind,rules:{include,exclude},sections,entryOverrides,itemOverrides[,letterSections]}.',
    inputSchema: { type: 'object', properties: { variant_id: variantId }, required: ['variant_id'], additionalProperties: false },
    handler: (a) => api('GET', `/api/variants/${enc(a.variant_id)}`),
  },
  {
    name: 'cv_create_variant',
    description: 'Create a variant. kind selects the render: "cv" (no rules = the full master), "resume", or "coverletter". name is free ("Frontend Resume"). Returns {id}.',
    inputSchema: {
      type: 'object',
      properties: { person_id: personId, name: { type: 'string', minLength: 1 }, kind: { type: 'string', enum: shared.VARIANT_KINDS } },
      required: ['person_id', 'name', 'kind'],
      additionalProperties: false,
    },
    handler: (a) => api('POST', `/api/persons/${enc(a.person_id)}/variants`, { name: a.name, kind: a.kind }),
  },
  {
    name: 'cv_delete_variant',
    description: 'Delete a variant (does not touch master content).',
    inputSchema: { type: 'object', properties: { variant_id: variantId }, required: ['variant_id'], additionalProperties: false },
    handler: (a) => api('DELETE', `/api/variants/${enc(a.variant_id)}`),
  },
  {
    name: 'cv_set_variant_rules',
    description:
      'Set a variant\'s tag query (replaces existing). include: entries/bullets must carry ≥1 of these (empty = all). ' +
      'exclude: drop anything carrying these (exclude beats include). No rules = the full master. Tags are matched ' +
      'EXACTLY (after case/separator normalization + alias folding) — use cv_search_tags to find the right tags, or ' +
      'cv_expand_variant_rules to fuzzy-grow the include set in one step.',
    inputSchema: {
      type: 'object',
      properties: { variant_id: variantId, include: tagList, exclude: tagList },
      required: ['variant_id'],
      additionalProperties: false,
    },
    handler: (a) => api('PUT', `/api/variants/${enc(a.variant_id)}/rules`, { include: a.include || [], exclude: a.exclude || [] }),
  },
  {
    name: 'cv_expand_variant_rules',
    description:
      'Grow a variant\'s include rules by fuzzy-matching each current include tag against the vocabulary and adding ' +
      'every tag scoring >= threshold (default 0.6), then writing the concrete expanded list back. Catches near-miss ' +
      'tags (e.g. front-end vs frontend) WITHOUT making resolution fuzzy — the expansion is materialized in the rule, ' +
      'so what renders stays exact and inspectable. Set the include seeds first (cv_set_variant_rules). Returns ' +
      '{before, after, added:[{tag, from, score, via}]}.',
    inputSchema: {
      type: 'object',
      properties: { variant_id: variantId, threshold: { type: 'number', minimum: 0, maximum: 1 }, limit: { type: 'integer', minimum: 1, maximum: 100 } },
      required: ['variant_id'],
      additionalProperties: false,
    },
    handler: (a) => {
      const body = {};
      if (a.threshold !== undefined) body.threshold = a.threshold;
      if (a.limit !== undefined) body.limit = a.limit;
      return api('POST', `/api/variants/${enc(a.variant_id)}/rules/expand`, body);
    },
  },
  {
    name: 'cv_set_variant_sections',
    description:
      'Set which sections appear in a variant and their order (replaces existing). Pass section ids (from cv_get_master). ' +
      'Empty list = inherit all master sections in master order. enabled:false hides a section.',
    inputSchema: {
      type: 'object',
      properties: {
        variant_id: variantId,
        sections: {
          type: 'array',
          items: { type: 'object', properties: { sectionId: { type: 'integer' }, enabled: { type: 'boolean' }, sortOrder: { type: 'integer' } }, required: ['sectionId'], additionalProperties: false },
        },
      },
      required: ['variant_id', 'sections'],
      additionalProperties: false,
    },
    handler: (a) => api('PUT', `/api/variants/${enc(a.variant_id)}/sections`, { sections: a.sections }),
  },
  {
    name: 'cv_set_variant_override',
    description:
      'Set a per-variant exception for one entry or bullet, overriding the tag rules. included: true forces in, ' +
      'false forces out, null clears. text_override rephrases (paragraph text / bullet content). Passing all of ' +
      'included/text_override/sort_override as null removes the override.',
    inputSchema: {
      type: 'object',
      properties: {
        variant_id: variantId,
        target_type: { type: 'string', enum: ['entry', 'item'] },
        target_id: { type: 'integer' },
        included: { type: ['boolean', 'null'] },
        text_override: { type: ['string', 'null'] },
        sort_override: { type: ['integer', 'null'] },
      },
      required: ['variant_id', 'target_type', 'target_id'],
      additionalProperties: false,
    },
    handler: (a) => api('PUT', `/api/variants/${enc(a.variant_id)}/overrides`, {
      targetType: a.target_type,
      targetId: a.target_id,
      included: a.included ?? null,
      textOverride: a.text_override ?? null,
      sortOverride: a.sort_override ?? null,
    }),
  },
  {
    name: 'cv_add_letter_section',
    description: 'Add a paragraph to a coverletter-kind variant (title + body). Returns {id}.',
    inputSchema: { type: 'object', properties: { variant_id: variantId, title: { type: 'string' }, body: { type: 'string' } }, required: ['variant_id', 'title', 'body'], additionalProperties: false },
    handler: (a) => api('POST', `/api/variants/${enc(a.variant_id)}/letter-sections`, { title: a.title, body: a.body }),
  },
  {
    name: 'cv_resolve_variant',
    description:
      'Preview exactly what a variant will render — the resolved {personal, sections:[…], coverletter} after rules + ' +
      'overrides. Use this to verify a variant before compiling, without producing a PDF.',
    inputSchema: { type: 'object', properties: { variant_id: variantId }, required: ['variant_id'], additionalProperties: false },
    handler: (a) => api('GET', `/api/variants/${enc(a.variant_id)}/resolve`),
  },
  {
    name: 'cv_get_pdf',
    description:
      'Compile a variant to PDF, save to disk, and return {path, size}. Read the path with the Read tool to view the ' +
      'rendered document.',
    inputSchema: { type: 'object', properties: { variant_id: variantId }, required: ['variant_id'], additionalProperties: false },
    handler: async (a) => {
      const bytes = await api('GET', `/api/variants/${enc(a.variant_id)}/pdf`, undefined, { expectBinary: true });
      await mkdir(PDF_DIR, { recursive: true });
      const path = join(PDF_DIR, `variant-${a.variant_id}.pdf`);
      await writeFile(path, Buffer.from(bytes));
      return { path, size: bytes.byteLength };
    },
  },
];

const tools = toolDefs.map(({ handler, ...spec }) => spec);
const toolMap = new Map(toolDefs.map((t) => [t.name, t]));

// ---------------------------------------------------------------------------
// Argument validation (the SDK advertises schemas but does not enforce them)
// ---------------------------------------------------------------------------

const ajv = new Ajv({ allErrors: true, useDefaults: false, coerceTypes: false });
const validators = new Map(toolDefs.map((t) => [t.name, ajv.compile(t.inputSchema)]));

async function callTool(name, args) {
  const def = toolMap.get(name);
  if (!def) throw new Error(`Unknown tool: ${name}`);
  const validate = validators.get(name);
  if (!validate(args)) throw new Error(`Invalid arguments for ${name}: ${ajv.errorsText(validate.errors, { separator: '; ' })}`);
  return await def.handler(args);
}

// ---------------------------------------------------------------------------
// MCP wiring
// ---------------------------------------------------------------------------

const server = new Server({ name: 'cv-editor', version: '0.2.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  try {
    const result = await callTool(name, args);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
  }
});

// Start the stdio transport only when run as the entrypoint (CLI / smoke test),
// so tests can import the tool catalog, validators, and api() helper without
// opening a connection.
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export { toolDefs, tools, toolMap, validators, callTool, api };
