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
 *   CV_MCP_PDF_DIR — directory where compiled PDFs are saved (default
 *                    $TMPDIR/cv-mcp-pdfs)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Ajv from 'ajv';

const BASE_URL = (process.env.CV_EDITOR_URL || 'http://localhost:3001').replace(/\/$/, '');
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
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
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
      'variants:[{id,name,kind,rules,sections}], tags}. Read this once, then edit by id. This is the ' +
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
      properties: { person_id: personId, slug: { type: 'string', pattern: '^[a-z0-9_-]+$' }, type: { type: 'string' }, title: { type: 'string' } },
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
      properties: { section_id: { type: 'integer' }, slug: { type: 'string', pattern: '^[a-z0-9_-]+$' }, type: { type: 'string' }, title: { type: 'string' } },
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
    description: 'Add a bullet to an entry. Returns {id}.',
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
    description: 'Add one or more tags to an entry or bullet. Tags drive variant inclusion. target: "entry" or "bullet".',
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
      properties: { person_id: personId, name: { type: 'string', minLength: 1 }, kind: { type: 'string', enum: ['cv', 'resume', 'coverletter'] } },
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
      'exclude: drop anything carrying these (exclude beats include). No rules = the full master.',
    inputSchema: {
      type: 'object',
      properties: { variant_id: variantId, include: tagList, exclude: tagList },
      required: ['variant_id'],
      additionalProperties: false,
    },
    handler: (a) => api('PUT', `/api/variants/${enc(a.variant_id)}/rules`, { include: a.include || [], exclude: a.exclude || [] }),
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

const transport = new StdioServerTransport();
await server.connect(transport);
