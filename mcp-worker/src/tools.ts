/**
 * cv tool catalog — the 57 `cv_*` tools, MOVED from cv/mcp-server/server.mjs into
 * the remote MCP Worker (the stdio server is retired once parity is verified).
 *
 * Identical to the stdio catalog except for what the Workers runtime forces:
 *   - validation: ajv compiles schemas with `new Function`, which the Workers
 *     runtime forbids → @cfworker/json-schema (a zero-eval interpreter).
 *   - cv_get_pdf: the stdio server wrote the PDF to local disk; a Worker has no
 *     filesystem, so it returns the PDF INLINE as a base64 MCP resource.
 *   - cv_install_layout: reads a local .zip from disk — impossible on a Worker, so
 *     it returns a clear "unsupported on the remote server" error (the ONLY tool
 *     whose behaviour intentionally diverges).
 *
 * Config (CV_EDITOR_URL + CV_EDITOR_TOKEN) comes from the Worker env, read at call
 * time via the `cloudflare:workers` global env.
 */
import shared from "@cv/constants"; // canonical enums/patterns (single source of truth)
import { Validator } from "@cfworker/json-schema";
import { env } from "cloudflare:workers";
import { signingSecret, signPayload } from "./sign";
import { cvCtx } from "./cv-ctx";

const enc = encodeURIComponent;

type CvEnv = { CV_EDITOR_URL?: string; CV_EDITOR_TOKEN?: string; CV_EDITOR_AUTH?: string; CV_ORIGIN_SECRET?: string; MCP_PUBLIC_URL?: string; COOKIE_SECRET?: string; GOOGLE_CLIENT_SECRET?: string };

/** Resolve the cv-editor base URL + Authorization header from the Worker env.
 *  Requires CV_EDITOR_URL (set in wrangler.jsonc to the Railway cv) — no localhost
 *  default, so a misconfiguration fails loudly instead of silently hitting localhost. */
function cvConfig(): { base: string; originSecret?: string } {
  const e = env as unknown as CvEnv;
  if (!e.CV_EDITOR_URL) throw new Error("CV_EDITOR_URL is not configured on this Worker.");
  const base = e.CV_EDITOR_URL.replace(/\/$/, "");
  // This Worker is one of cv's two front doors; the origin rejects callers that don't
  // present this secret (cv editor/lib/origin-guard.js). It ALSO authorizes the
  // per-caller X-User-Id we inject below — cv trusts X-User-Id only behind this secret.
  return { base, originSecret: e.CV_ORIGIN_SECRET };
}

type ApiOpts = { expectBinary?: boolean };

/** HTTP helper — same request construction + contract-error mapping as the stdio server. */
export async function api(method: string, path: string, body?: unknown, { expectBinary = false }: ApiOpts = {}): Promise<any> {
  const { base, originSecret } = cvConfig();
  // WHO this call runs as, set at the dispatch boundary (mcp.ts CallTool / servePdf).
  // Required: cv is scoped per-user by X-User-Id now, so a missing context is a bug —
  // fail loudly rather than silently falling through to the owner/demo account.
  const cvUserId = cvCtx.getStore()?.cvUserId;
  if (cvUserId == null) throw new Error("No authenticated cv user in context for this MCP call.");
  let res: Response;
  try {
    res = await fetch(base + path, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        "X-User-Id": String(cvUserId),
        ...(originSecret ? { "X-Origin-Secret": originSecret } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e: any) {
    throw new Error(`Could not reach cv-editor at ${base}: ${e.message}. Make sure the cv-editor server is running.`);
  }

  const ct = res.headers.get("content-type") || "";
  if (expectBinary && res.ok) return await res.arrayBuffer();

  if (ct.includes("application/json")) {
    const data: any = await res.json();
    if (!res.ok) {
      // Contract error envelope {error:{code,message,details?}}; tolerate a bare
      // string error or a top-level message for resilience/back-compat.
      const er = data && data.error;
      const msg = er && typeof er === "object"
        ? [er.message, er.code && `(${er.code})`].filter(Boolean).join(" ")
        : (er || (data && data.message) || "");
      throw new Error(`HTTP ${res.status} ${method} ${path}${msg ? `: ${msg}` : ""}`);
    }
    return data;
  }
  const text = (await res.text()).slice(0, 200);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${method} ${path}: ${text}`);
  return text;
}

/** Fetch a variant's compiled PDF bytes from the cv backend (admin-authed). Used by the
 *  signed /pdf/<token> download route (index.ts); cv_get_pdf just hands out the link. */
export async function fetchVariantPdf(variantId: number | string): Promise<ArrayBuffer> {
  return (await api("GET", `/api/variants/${enc(variantId)}/pdf`, undefined, { expectBinary: true })) as ArrayBuffer;
}

// Shared schema fragments (verbatim from the stdio catalog).
const personId = { type: "integer", description: "Person id (from cv_list_persons)" };
const variantId = { type: "integer", description: "Variant id (from cv_list_variants / cv_get_main)" };
const tagList = { type: "array", items: { type: "string" }, description: "Tag names (free strings)" };
const layoutId = { type: "string", description: "Layout id (slug, from cv_list_layouts)" };
const idList = { type: "array", items: { type: "integer", minimum: 1 }, minItems: 1, description: "Ids in the desired order" };

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
  handler: (a: any) => unknown | Promise<unknown>;
}

const toolDefs: ToolDef[] = [
  {
    name: "cv_health",
    description: "Ping the cv-editor backend. Returns {status, service, version, uptime_s, persons}. Call first if other tools error.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: () => api("GET", "/api/health"),
  },
  {
    name: "cv_list_persons",
    description: "List every profile: {persons:[{id,name,created_at}]}. Always safe. Use ids with cv_get_main etc.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: () => api("GET", "/api/persons"),
  },
  {
    name: "cv_get_main",
    description:
      "Return a person's FULL main CV with stable ids: {person, personal, " +
      "sections:[{id,slug,type,title,sortOrder,entries:[{id,fields,tags,items:[{id,content,title,tags}]}]}], " +
      "variants:[{id,name,kind,rules,sections}], tags, tagAliases}. Read this once, then edit by id. This is the " +
      "canonical read — ids here are valid for every edit/tag/override tool. (Cover-letter headers are per-variant " +
      "now — see cv_resolve_variant / the letter-section tools, not a top-level `coverletter`.)",
    inputSchema: { type: "object", properties: { person_id: personId }, required: ["person_id"], additionalProperties: false },
    handler: (a) => api("GET", `/api/persons/${enc(a.person_id)}`),
  },
  {
    name: "cv_create_person",
    description: "Create a new empty profile. Returns {id}.",
    inputSchema: { type: "object", properties: { name: { type: "string", minLength: 1, maxLength: 200 } }, required: ["name"], additionalProperties: false },
    handler: (a) => api("POST", "/api/persons", { name: a.name }),
  },
  {
    name: "cv_delete_person",
    description: "Delete a profile and ALL its content and variants.",
    inputSchema: { type: "object", properties: { person_id: personId }, required: ["person_id"], additionalProperties: false },
    handler: (a) => api("DELETE", `/api/persons/${enc(a.person_id)}`),
  },
  {
    name: "cv_set_personal",
    description: "Update personal info fields (firstName, lastName, position, email, github, …). Only passed fields change; all values must be strings.",
    inputSchema: {
      type: "object",
      properties: { person_id: personId, fields: { type: "object", description: "field → string value", minProperties: 1 } },
      required: ["person_id", "fields"],
      additionalProperties: false,
    },
    handler: (a) => {
      for (const [k, v] of Object.entries(a.fields)) {
        if (typeof v !== "string") throw new Error(`Personal field "${k}" must be a string, got ${typeof v}`);
      }
      return api("PATCH", `/api/persons/${enc(a.person_id)}/personal`, a.fields);
    },
  },
  // ---- Sections / entries / bullets (main content) ----
  {
    name: "cv_add_section",
    description: "Add a section to a person. slug is kebab-case (unique per person). type: experience, education, projects, skills, certifications, references, summary, honors, writing, … Returns {id}.",
    inputSchema: {
      type: "object",
      properties: { person_id: personId, slug: { type: "string", pattern: shared.SLUG_PATTERN }, type: { type: "string" }, title: { type: "string" } },
      required: ["person_id", "slug", "type", "title"],
      additionalProperties: false,
    },
    handler: (a) => api("POST", `/api/persons/${enc(a.person_id)}/sections`, { slug: a.slug, type: a.type, title: a.title }),
  },
  {
    name: "cv_update_section",
    description: "Update a section's title (and optionally slug/type). Pass at least one of slug, type, title.",
    inputSchema: {
      type: "object",
      properties: { section_id: { type: "integer" }, slug: { type: "string", pattern: shared.SLUG_PATTERN }, type: { type: "string" }, title: { type: "string" } },
      required: ["section_id"],
      additionalProperties: false,
    },
    handler: (a) => {
      const body: Record<string, any> = {};
      for (const k of ["slug", "type", "title"]) if (a[k] !== undefined) body[k] = a[k];
      if (!Object.keys(body).length) throw new Error("cv_update_section needs at least one of: slug, type, title");
      return api("PUT", `/api/sections/${enc(a.section_id)}`, body);
    },
  },
  {
    name: "cv_delete_section",
    description: "Delete a section and all its entries/bullets.",
    inputSchema: { type: "object", properties: { section_id: { type: "integer" } }, required: ["section_id"], additionalProperties: false },
    handler: (a) => api("DELETE", `/api/sections/${enc(a.section_id)}`),
  },
  {
    name: "cv_add_entry",
    description:
      "Add an entry to a section. fields are type-specific: experience/projects {position, organization, location, date}; " +
      "education {position, organization, location, date, program, major}; skills {category, skills}; " +
      "certifications {award, issuer, location, date}; summary {text}. All values strings. Returns {id}.",
    inputSchema: {
      type: "object",
      properties: { section_id: { type: "integer" }, fields: { type: "object", minProperties: 1 } },
      required: ["section_id", "fields"],
      additionalProperties: false,
    },
    handler: (a) => api("POST", `/api/sections/${enc(a.section_id)}/entries`, { fields: a.fields }),
  },
  {
    name: "cv_update_entry",
    description: "Replace an entry's fields.",
    inputSchema: { type: "object", properties: { entry_id: { type: "integer" }, fields: { type: "object" } }, required: ["entry_id", "fields"], additionalProperties: false },
    handler: (a) => api("PUT", `/api/entries/${enc(a.entry_id)}`, { fields: a.fields }),
  },
  {
    name: "cv_delete_entry",
    description: "Delete an entry and its bullets.",
    inputSchema: { type: "object", properties: { entry_id: { type: "integer" } }, required: ["entry_id"], additionalProperties: false },
    handler: (a) => api("DELETE", `/api/entries/${enc(a.entry_id)}`),
  },
  {
    name: "cv_add_bullet",
    description:
      "Add a bullet to an entry. Returns {id}. After adding, tag it consistently: call cv_suggest_tags with the " +
      "bullet text and apply the fitting existing tags via cv_tag.",
    inputSchema: { type: "object", properties: { entry_id: { type: "integer" }, content: { type: "string" }, title: { type: "string" } }, required: ["entry_id", "content"], additionalProperties: false },
    handler: (a) => api("POST", `/api/entries/${enc(a.entry_id)}/items`, { content: a.content, ...(a.title !== undefined ? { title: a.title } : {}) }),
  },
  {
    name: "cv_update_bullet",
    description: "Update a bullet's content and/or title. Pass at least one.",
    inputSchema: { type: "object", properties: { item_id: { type: "integer" }, content: { type: "string" }, title: { type: "string" } }, required: ["item_id"], additionalProperties: false },
    handler: (a) => {
      const body: Record<string, any> = {};
      if (a.content !== undefined) body.content = a.content;
      if (a.title !== undefined) body.title = a.title;
      if (!Object.keys(body).length) throw new Error("cv_update_bullet needs at least one of: content, title");
      return api("PUT", `/api/items/${enc(a.item_id)}`, body);
    },
  },
  {
    name: "cv_delete_bullet",
    description: "Delete a bullet.",
    inputSchema: { type: "object", properties: { item_id: { type: "integer" } }, required: ["item_id"], additionalProperties: false },
    handler: (a) => api("DELETE", `/api/items/${enc(a.item_id)}`),
  },
  // ---- Tags ----
  {
    name: "cv_tag",
    description:
      "Add one or more tags to an entry or bullet. Tags drive variant inclusion and are matched exactly (after " +
      "case/separator normalization + alias folding). target: \"entry\" or \"bullet\". To choose tags for a new or " +
      "edited bullet/entry, call cv_suggest_tags with its TEXT first and apply the fitting existing tags; only coin " +
      "a new tag (and promote it with cv_add_catalog_tag) when nothing suggested fits. Keeps the vocabulary consistent.",
    inputSchema: {
      type: "object",
      properties: { target: { type: "string", enum: ["entry", "bullet"] }, id: { type: "integer" }, tags: tagList },
      required: ["target", "id", "tags"],
      additionalProperties: false,
    },
    handler: (a) => api("POST", `/api/${a.target === "bullet" ? "items" : "entries"}/${enc(a.id)}/tags`, { tags: a.tags }),
  },
  {
    name: "cv_untag",
    description: "Remove a single tag from an entry or bullet. target: \"entry\" or \"bullet\".",
    inputSchema: {
      type: "object",
      properties: { target: { type: "string", enum: ["entry", "bullet"] }, id: { type: "integer" }, tag: { type: "string" } },
      required: ["target", "id", "tag"],
      additionalProperties: false,
    },
    handler: (a) => api("DELETE", `/api/${a.target === "bullet" ? "items" : "entries"}/${enc(a.id)}/tags/${enc(a.tag)}`),
  },
  {
    name: "cv_search_tags",
    description:
      "Fuzzy-search a person's existing tag vocabulary — tolerant of typos, case/separator variants, prefixes, and " +
      "aliases. Returns {query, results:[{tag, score, count, via}]} ranked best-first (score in 0..1). Call this " +
      "BEFORE coining a new tag and reuse a close existing one (score ~0.7+) so the vocabulary does not fragment, and " +
      "before writing variant rules to find the exact tags to include. Approximate — never auto-applied to a render.",
    inputSchema: {
      type: "object",
      properties: {
        person_id: personId,
        q: { type: "string", minLength: 1, description: "Search text" },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "Max results (default 10)" },
        min_score: { type: "number", minimum: 0, maximum: 1, description: "Score floor (default 0.3)" },
      },
      required: ["person_id", "q"],
      additionalProperties: false,
    },
    handler: (a) => {
      const qs = [`q=${enc(a.q)}`];
      if (a.limit !== undefined) qs.push(`limit=${enc(a.limit)}`);
      if (a.min_score !== undefined) qs.push(`min_score=${enc(a.min_score)}`);
      return api("GET", `/api/persons/${enc(a.person_id)}/tags/search?${qs.join("&")}`);
    },
  },
  {
    name: "cv_alias_tag",
    description:
      "Define a tag alias (alias → canonical), e.g. \"ml\" → \"machine-learning\" or \"js\" → \"javascript\". Bridges true " +
      "synonyms that fuzzy matching cannot. Once set, tagging or writing a rule with the alias stores the canonical " +
      "instead, and existing uses of the alias are folded into the canonical — the vocabulary converges. Rejects " +
      "self-aliases and cycles (409).",
    inputSchema: {
      type: "object",
      properties: { person_id: personId, alias: { type: "string", minLength: 1 }, canonical: { type: "string", minLength: 1 } },
      required: ["person_id", "alias", "canonical"],
      additionalProperties: false,
    },
    handler: (a) => api("PUT", `/api/persons/${enc(a.person_id)}/tag-aliases`, { alias: a.alias, canonical: a.canonical }),
  },
  {
    name: "cv_unalias_tag",
    description: "Remove a tag alias. Tags already folded into the canonical are left as-is.",
    inputSchema: {
      type: "object",
      properties: { person_id: personId, alias: { type: "string", minLength: 1 } },
      required: ["person_id", "alias"],
      additionalProperties: false,
    },
    handler: (a) => api("DELETE", `/api/persons/${enc(a.person_id)}/tag-aliases/${enc(a.alias)}`),
  },
  {
    name: "cv_suggest_tags",
    description:
      "Given a piece of bullet/entry TEXT, return EXISTING tags that fit it, ranked best-first, drawn from the " +
      "person's tag catalog (controlled vocabulary) + current usage vocabulary: {query, results:[{tag, score, " +
      "inCatalog, count, via}]}. This is the smart-tagging primitive — call it when adding or editing content, then " +
      "apply the high-scoring existing tags with cv_tag instead of coining near-duplicates. Suggestions are " +
      "candidates only; nothing is written until you call cv_tag. Prefer tags where inCatalog is true.",
    inputSchema: {
      type: "object",
      properties: {
        person_id: personId,
        text: { type: "string", minLength: 1, description: "The bullet/entry text to tag" },
        limit: { type: "integer", minimum: 1, maximum: 50, description: "Max suggestions (default 8)" },
        min_score: { type: "number", minimum: 0, maximum: 1, description: "Score floor (default 0.35)" },
        scorer: { type: "string", enum: shared.SCORER_METHODS, description: "Ranking method; lexical (default) needs no model. embedding is an optional local semantic scorer for bulk/offline use." },
      },
      required: ["person_id", "text"],
      additionalProperties: false,
    },
    handler: (a) => {
      const body: Record<string, any> = { text: a.text };
      if (a.limit !== undefined) body.limit = a.limit;
      if (a.min_score !== undefined) body.minScore = a.min_score;
      if (a.scorer !== undefined) body.scorer = a.scorer;
      return api("POST", `/api/persons/${enc(a.person_id)}/tags/suggest`, body);
    },
  },
  {
    name: "cv_list_tag_catalog",
    description:
      "List the person's tag catalog — the curated controlled vocabulary: [{tag, description, category}]. This is " +
      "the preferred target set for tagging; cv_suggest_tags ranks catalog members first.",
    inputSchema: { type: "object", properties: { person_id: personId }, required: ["person_id"], additionalProperties: false },
    handler: (a) => api("GET", `/api/persons/${enc(a.person_id)}/tags/catalog`),
  },
  {
    name: "cv_add_catalog_tag",
    description:
      "Add/define a canonical tag in the catalog (optional description + category like \"skill\"/\"domain\"/\"role\"). " +
      "Use when a genuinely new concept appears that no existing or suggested tag covers — promoting it makes future " +
      "content tag to it consistently. The tag is normalized + alias-folded before storing.",
    inputSchema: {
      type: "object",
      properties: {
        person_id: personId,
        tag: { type: "string", minLength: 1 },
        description: { type: "string" },
        category: { type: "string" },
      },
      required: ["person_id", "tag"],
      additionalProperties: false,
    },
    handler: (a) => {
      const body: Record<string, any> = { tag: a.tag };
      if (a.description !== undefined) body.description = a.description;
      if (a.category !== undefined) body.category = a.category;
      return api("PUT", `/api/persons/${enc(a.person_id)}/tags/catalog`, body);
    },
  },
  {
    name: "cv_remove_catalog_tag",
    description: "Remove a tag from the catalog. Does not touch content already tagged with it.",
    inputSchema: {
      type: "object",
      properties: { person_id: personId, tag: { type: "string", minLength: 1 } },
      required: ["person_id", "tag"],
      additionalProperties: false,
    },
    handler: (a) => api("DELETE", `/api/persons/${enc(a.person_id)}/tags/catalog/${enc(a.tag)}`),
  },
  {
    name: "cv_seed_catalog",
    description:
      "Bootstrap the catalog by promoting all currently-used tags into it (one-time convenience; then prune/curate). " +
      "Returns {added}.",
    inputSchema: { type: "object", properties: { person_id: personId }, required: ["person_id"], additionalProperties: false },
    handler: (a) => api("POST", `/api/persons/${enc(a.person_id)}/tags/catalog/seed`),
  },
  {
    name: "cv_suggest_tags_bulk",
    description:
      "Suggest tags for EVERY entry and bullet of a person in one call — use right after importing an untagged CV to " +
      "tag the whole thing efficiently. Returns {count, items:[{target, id, text, current, suggestions:[…]}]}. " +
      "Suggest-only: nothing is written. Review and apply the good ones with cv_tag. Pass scorer:\"embedding\" for " +
      "local semantic ranking over many items without per-item frontier cost.",
    inputSchema: {
      type: "object",
      properties: {
        person_id: personId,
        limit: { type: "integer", minimum: 1, maximum: 50, description: "Max suggestions per item (default 5)" },
        min_score: { type: "number", minimum: 0, maximum: 1, description: "Score floor (default 0.4)" },
        scorer: { type: "string", enum: shared.SCORER_METHODS },
      },
      required: ["person_id"],
      additionalProperties: false,
    },
    handler: (a) => {
      const body: Record<string, any> = {};
      if (a.limit !== undefined) body.limit = a.limit;
      if (a.min_score !== undefined) body.minScore = a.min_score;
      if (a.scorer !== undefined) body.scorer = a.scorer;
      return api("POST", `/api/persons/${enc(a.person_id)}/tags/suggest-bulk`, body);
    },
  },
  // ---- Variants ----
  {
    name: "cv_list_variants",
    description: "List a person's variants: [{id,name,kind,created_at}]. kind ∈ cv|resume|coverletter.",
    inputSchema: { type: "object", properties: { person_id: personId }, required: ["person_id"], additionalProperties: false },
    handler: (a) => api("GET", `/api/persons/${enc(a.person_id)}/variants`),
  },
  {
    name: "cv_get_variant",
    description: "Return a variant's full config: {id,name,kind,rules:{include,exclude},sections,entryOverrides,itemOverrides[,letterSections]}.",
    inputSchema: { type: "object", properties: { variant_id: variantId }, required: ["variant_id"], additionalProperties: false },
    handler: (a) => api("GET", `/api/variants/${enc(a.variant_id)}`),
  },
  {
    name: "cv_create_variant",
    description: "Create a variant. kind selects the render: \"cv\" (no rules = the full main), \"resume\", or \"coverletter\". name is free (\"Frontend Resume\"). Returns {id}.",
    inputSchema: {
      type: "object",
      properties: { person_id: personId, name: { type: "string", minLength: 1 }, kind: { type: "string", enum: shared.VARIANT_KINDS } },
      required: ["person_id", "name", "kind"],
      additionalProperties: false,
    },
    handler: (a) => api("POST", `/api/persons/${enc(a.person_id)}/variants`, { name: a.name, kind: a.kind }),
  },
  {
    name: "cv_delete_variant",
    description: "Delete a variant (does not touch main content).",
    inputSchema: { type: "object", properties: { variant_id: variantId }, required: ["variant_id"], additionalProperties: false },
    handler: (a) => api("DELETE", `/api/variants/${enc(a.variant_id)}`),
  },
  {
    name: "cv_set_variant_rules",
    description:
      "Set a variant's tag query (replaces existing). include: entries/bullets must carry ≥1 of these (empty = all). " +
      "exclude: drop anything carrying these (exclude beats include). No rules = the full main. Tags are matched " +
      "EXACTLY (after case/separator normalization + alias folding) — use cv_search_tags to find the right tags, or " +
      "cv_expand_variant_rules to fuzzy-grow the include set in one step.",
    inputSchema: {
      type: "object",
      properties: { variant_id: variantId, include: tagList, exclude: tagList },
      required: ["variant_id"],
      additionalProperties: false,
    },
    handler: (a) => api("PUT", `/api/variants/${enc(a.variant_id)}/rules`, { include: a.include || [], exclude: a.exclude || [] }),
  },
  {
    name: "cv_expand_variant_rules",
    description:
      "Grow a variant's include rules by fuzzy-matching each current include tag against the vocabulary and adding " +
      "every tag scoring >= threshold (default 0.6), then writing the concrete expanded list back. Catches near-miss " +
      "tags (e.g. front-end vs frontend) WITHOUT making resolution fuzzy — the expansion is materialized in the rule, " +
      "so what renders stays exact and inspectable. Set the include seeds first (cv_set_variant_rules). Returns " +
      "{before, after, added:[{tag, from, score, via}]}.",
    inputSchema: {
      type: "object",
      properties: { variant_id: variantId, threshold: { type: "number", minimum: 0, maximum: 1 }, limit: { type: "integer", minimum: 1, maximum: 100 } },
      required: ["variant_id"],
      additionalProperties: false,
    },
    handler: (a) => {
      const body: Record<string, any> = {};
      if (a.threshold !== undefined) body.threshold = a.threshold;
      if (a.limit !== undefined) body.limit = a.limit;
      return api("POST", `/api/variants/${enc(a.variant_id)}/rules/expand`, body);
    },
  },
  {
    name: "cv_set_variant_sections",
    description:
      "Set which sections appear in a variant and their order (replaces existing). Pass section ids (from cv_get_main). " +
      "Empty list = inherit all main sections in main order. enabled:false hides a section.",
    inputSchema: {
      type: "object",
      properties: {
        variant_id: variantId,
        sections: {
          type: "array",
          items: { type: "object", properties: { sectionId: { type: "integer" }, enabled: { type: "boolean" }, sortOrder: { type: "integer" } }, required: ["sectionId"], additionalProperties: false },
        },
      },
      required: ["variant_id", "sections"],
      additionalProperties: false,
    },
    handler: (a) => api("PUT", `/api/variants/${enc(a.variant_id)}/sections`, { sections: a.sections }),
  },
  {
    name: "cv_set_variant_override",
    description:
      "Set a per-variant exception for one entry or bullet, overriding the tag rules. included: true forces in, " +
      "false forces out, null clears. text_override rephrases (paragraph text / bullet content). fields_override " +
      "(entry targets only) is a per-variant field patch, e.g. {position: 'Staff Engineer'} for a variant-specific " +
      "role subheading, or {date: ''} to blank a field; {} clears it. Passing all of included/text_override/" +
      "sort_override/fields_override as null removes the override.",
    inputSchema: {
      type: "object",
      properties: {
        variant_id: variantId,
        target_type: { type: "string", enum: ["entry", "item"] },
        target_id: { type: "integer" },
        included: { type: ["boolean", "null"] },
        text_override: { type: ["string", "null"] },
        sort_override: { type: ["integer", "null"] },
        fields_override: { type: ["object", "null"], additionalProperties: { type: "string" } },
      },
      required: ["variant_id", "target_type", "target_id"],
      additionalProperties: false,
    },
    handler: (a) => api("PUT", `/api/variants/${enc(a.variant_id)}/overrides`, {
      targetType: a.target_type,
      targetId: a.target_id,
      included: a.included ?? null,
      textOverride: a.text_override ?? null,
      sortOverride: a.sort_override ?? null,
      fieldsOverride: a.fields_override ?? null,
    }),
  },
  {
    name: "cv_add_letter_section",
    description: "Add a paragraph to a coverletter-kind variant (title + body). Returns {id}.",
    inputSchema: { type: "object", properties: { variant_id: variantId, title: { type: "string" }, body: { type: "string" } }, required: ["variant_id", "title", "body"], additionalProperties: false },
    handler: (a) => api("POST", `/api/variants/${enc(a.variant_id)}/letter-sections`, { title: a.title, body: a.body }),
  },
  {
    name: "cv_resolve_variant",
    description:
      "Preview exactly what a variant will render — the resolved {personal, sections:[…], coverletter} after rules + " +
      "overrides. Use this to verify a variant before compiling, without producing a PDF.",
    inputSchema: { type: "object", properties: { variant_id: variantId }, required: ["variant_id"], additionalProperties: false },
    handler: (a) => api("GET", `/api/variants/${enc(a.variant_id)}/resolve`),
  },
  {
    name: "cv_get_pdf",
    description:
      "Compile a variant to PDF and return a short-lived signed download link (the Worker streams the PDF from the " +
      "cv backend when the link is opened). Claude clients reject an inline PDF blob, so it's delivered as a URL.",
    inputSchema: { type: "object", properties: { variant_id: variantId }, required: ["variant_id"], additionalProperties: false },
    handler: async (a) => {
      const e = env as unknown as CvEnv;
      const secret = signingSecret(e);
      if (!secret) throw new Error("Server misconfigured: no signing secret (COOKIE_SECRET/GOOGLE_CLIENT_SECRET) for PDF links.");
      const base = (e.MCP_PUBLIC_URL || "").replace(/\/$/, "");
      if (!base) throw new Error("Server misconfigured: MCP_PUBLIC_URL is not set.");
      // Bind the link to the caller: the /pdf route fetches cv as this user (the token is
      // HMAC-signed, so `u` can't be forged). Scopes the PDF to whoever asked for it.
      const cvUserId = cvCtx.getStore()?.cvUserId;
      const token = await signPayload({ v: a.variant_id, u: cvUserId }, secret);
      return { __content: [{ type: "text", text: `PDF for variant ${a.variant_id} is ready — download (link valid ~5 min, compiles on open): ${base}/pdf/${token}` }] };
    },
  },

  // ---- Layouts ----
  {
    name: "cv_list_layouts",
    description:
      "List installed LaTeX layouts and the global default: {layouts:[{id,name,version,kinds,status,source,builtin}], default}. " +
      "A layout decides how a variant is typeset; \"awesome-cv\" is the builtin default. Pick one per variant with " +
      "cv_set_variant_layout, or change the global default with cv_set_default_layout.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: () => api("GET", "/api/layouts"),
  },
  {
    name: "cv_set_default_layout",
    description: "Set the global default layout (used by any variant that has not chosen its own). layout_id from cv_list_layouts.",
    inputSchema: { type: "object", properties: { layout_id: layoutId }, required: ["layout_id"], additionalProperties: false },
    handler: (a) => api("PUT", "/api/layouts/default", { layout_id: a.layout_id }),
  },
  {
    name: "cv_set_variant_layout",
    description:
      "Choose a variant's layout. Pass a layout_id (from cv_list_layouts) to override, or null to revert to the global " +
      "default. The layout must support the variant's kind (cv/resume/coverletter).",
    inputSchema: {
      type: "object",
      properties: { variant_id: variantId, layout_id: { type: ["string", "null"], description: "Layout id, or null to revert to the default" } },
      required: ["variant_id", "layout_id"],
      additionalProperties: false,
    },
    handler: (a) => api("PUT", `/api/variants/${enc(a.variant_id)}/layout`, { layout_id: a.layout_id }),
  },
  {
    name: "cv_install_layout",
    description:
      "Install a new layout from a local .zip bundle. NOTE: UNAVAILABLE on the remote MCP server — it reads a file " +
      "from the local filesystem, which a Worker does not have. Install layouts from a local dev session instead.",
    inputSchema: { type: "object", properties: { zip_path: { type: "string", minLength: 1 } }, required: ["zip_path"], additionalProperties: false },
    handler: () => {
      throw new Error("cv_install_layout is unavailable on the remote MCP server (no local filesystem to read the .zip). Install layouts from a local dev session, or use a future upload-based flow.");
    },
  },
  {
    name: "cv_verify_layout",
    description:
      "Re-run the contract gate on an installed layout (e.g. after adding new content). Returns the report; a layout that " +
      "now fails is marked invalid and variants using it fall back to the default until fixed.",
    inputSchema: { type: "object", properties: { layout_id: layoutId }, required: ["layout_id"], additionalProperties: false },
    handler: (a) => api("POST", `/api/layouts/${enc(a.layout_id)}/verify`),
  },
  {
    name: "cv_delete_layout",
    description: "Delete an uploaded layout (builtins cannot be deleted). Variants using it revert to the global default.",
    inputSchema: { type: "object", properties: { layout_id: layoutId }, required: ["layout_id"], additionalProperties: false },
    handler: (a) => api("DELETE", `/api/layouts/${enc(a.layout_id)}`),
  },
  {
    name: "cv_get_layout",
    description: "Get one layout's full detail + last verification report: {id,name,version,kinds,status,source,manifest,report}. (cv_list_layouts returns the summary list.)",
    inputSchema: { type: "object", properties: { layout_id: layoutId }, required: ["layout_id"], additionalProperties: false },
    handler: (a) => api("GET", `/api/layouts/${enc(a.layout_id)}`),
  },

  // ---- Reference + global style settings ----
  {
    name: "cv_catalog",
    description:
      "Reference data for authoring a CV: {validSectionTypes, latexTypeMap, socialCatalog, identityExtras, accentColors, styleDefaults, latexUnits}. Use to discover valid section types, social-link keys, accent colors, and style/unit options. No args.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: () => api("GET", "/api/catalog"),
  },
  {
    name: "cv_get_settings",
    description: "Read GLOBAL style/spacing/fonts settings (shared by every variant) as a flat {key:value} map. Optional prefix ∈ style|spacing|fonts narrows it.",
    inputSchema: { type: "object", properties: { prefix: { type: "string", enum: ["style", "spacing", "fonts"] } }, additionalProperties: false },
    handler: (a) => api("GET", `/api/settings${a.prefix ? `?prefix=${enc(a.prefix)}` : ""}`),
  },
  {
    name: "cv_set_settings",
    description:
      "Update GLOBAL style/spacing/fonts (merges the given keys). settings is a flat map of prefixed keys, e.g. {\"style.accentColor\":\"awesome-red\", \"spacing.horizontalMargin\":{\"num\":1.4,\"unit\":\"cm\"}, \"fonts.headerNameSize\":{\"num\":32,\"unit\":\"pt\"}}. See cv_catalog for valid colors/units.",
    inputSchema: { type: "object", properties: { settings: { type: "object", minProperties: 1 } }, required: ["settings"], additionalProperties: false },
    handler: (a) => api("PATCH", "/api/settings", a.settings),
  },

  // ---- Person rename / export / import ----
  {
    name: "cv_rename_person",
    description: "Rename a person/profile (names are unique).",
    inputSchema: { type: "object", properties: { person_id: personId, name: { type: "string", minLength: 1 } }, required: ["person_id", "name"], additionalProperties: false },
    handler: (a) => api("PUT", `/api/persons/${enc(a.person_id)}`, { name: a.name }),
  },
  {
    name: "cv_export_person",
    description: "Export a person as a portable JSON snapshot (personal + sections/entries/items + tags + variants). Pair with cv_import_person to back up or clone a profile.",
    inputSchema: { type: "object", properties: { person_id: personId }, required: ["person_id"], additionalProperties: false },
    handler: (a) => api("GET", `/api/persons/${enc(a.person_id)}/export`),
  },
  {
    name: "cv_import_person",
    description: "Import a snapshot (from cv_export_person) INTO an existing person, replacing its content. data is the exported object.",
    inputSchema: { type: "object", properties: { person_id: personId, data: { type: "object", minProperties: 1 } }, required: ["person_id", "data"], additionalProperties: false },
    handler: (a) => api("POST", `/api/persons/${enc(a.person_id)}/import`, a.data),
  },

  // ---- Reordering (pass the full id list in the new order) ----
  {
    name: "cv_reorder_sections",
    description: "Reorder a person's sections. ids = ALL of the person's section ids in the desired order (from cv_get_main).",
    inputSchema: { type: "object", properties: { person_id: personId, ids: idList }, required: ["person_id", "ids"], additionalProperties: false },
    handler: (a) => api("PATCH", `/api/persons/${enc(a.person_id)}/sections/order`, { ids: a.ids }),
  },
  {
    name: "cv_reorder_entries",
    description: "Reorder entries within a section. ids = the section's entry ids in the desired order.",
    inputSchema: { type: "object", properties: { section_id: { type: "integer" }, ids: idList }, required: ["section_id", "ids"], additionalProperties: false },
    handler: (a) => api("PATCH", `/api/sections/${enc(a.section_id)}/entries/order`, { ids: a.ids }),
  },
  {
    name: "cv_reorder_bullets",
    description: "Reorder bullets within an entry. ids = the entry's bullet/item ids in the desired order.",
    inputSchema: { type: "object", properties: { entry_id: { type: "integer" }, ids: idList }, required: ["entry_id", "ids"], additionalProperties: false },
    handler: (a) => api("PATCH", `/api/entries/${enc(a.entry_id)}/items/order`, { ids: a.ids }),
  },

  // ---- Variant rename + cover-letter paragraph edit/delete/reorder ----
  {
    name: "cv_rename_variant",
    description: "Rename a variant.",
    inputSchema: { type: "object", properties: { variant_id: variantId, name: { type: "string", minLength: 1 } }, required: ["variant_id", "name"], additionalProperties: false },
    handler: (a) => api("PUT", `/api/variants/${enc(a.variant_id)}`, { name: a.name }),
  },
  {
    name: "cv_update_letter_section",
    description: "Edit a cover-letter paragraph (title and/or body). letter_section_id from cv_get_variant (letterSections).",
    inputSchema: { type: "object", properties: { variant_id: variantId, letter_section_id: { type: "integer" }, title: { type: "string" }, body: { type: "string" } }, required: ["variant_id", "letter_section_id"], additionalProperties: false },
    handler: (a) => {
      const body: Record<string, any> = {};
      if (a.title !== undefined) body.title = a.title;
      if (a.body !== undefined) body.body = a.body;
      return api("PUT", `/api/variants/${enc(a.variant_id)}/letter-sections/${enc(a.letter_section_id)}`, body);
    },
  },
  {
    name: "cv_delete_letter_section",
    description: "Delete a cover-letter paragraph from a coverletter variant.",
    inputSchema: { type: "object", properties: { variant_id: variantId, letter_section_id: { type: "integer" } }, required: ["variant_id", "letter_section_id"], additionalProperties: false },
    handler: (a) => api("DELETE", `/api/variants/${enc(a.variant_id)}/letter-sections/${enc(a.letter_section_id)}`),
  },
  {
    name: "cv_reorder_letter_sections",
    description: "Reorder a cover letter's paragraphs. ids = letter-section ids in the desired order.",
    inputSchema: { type: "object", properties: { variant_id: variantId, ids: idList }, required: ["variant_id", "ids"], additionalProperties: false },
    handler: (a) => api("PATCH", `/api/variants/${enc(a.variant_id)}/letter-sections/order`, { ids: a.ids }),
  },

  // ---- LinkedIn / Indeed / Handshake export + drift tracking ----
  {
    name: "cv_export_linkedin",
    description:
      "Export a variant's work history as paste-ready blocks for LinkedIn / Indeed / Handshake (none exposes an " +
      "individual profile-write API, so the CV is the source of truth and you paste). Returns {variantId, format, limits, " +
      "positions:[{entryId,title,company,location,start,end,description,overLimit,fingerprint}]}. person_id is required; " +
      "variant_id picks the lens (default: the person's cv variant). format ∈ linkedin (• bullets) | plaintext | markdown (- bullets).",
    inputSchema: { type: "object", properties: { person_id: personId, variant_id: variantId, format: { type: "string", enum: ["linkedin", "plaintext", "markdown"], description: "Bullet style (default: linkedin)" } }, required: ["person_id"], additionalProperties: false },
    handler: (a) => {
      const qs = new URLSearchParams();
      if (a.variant_id != null) qs.set("variant", String(a.variant_id));
      if (a.format) qs.set("format", a.format);
      const q = qs.toString();
      return api("GET", `/api/persons/${enc(a.person_id)}/linkedin${q ? `?${q}` : ""}`);
    },
  },
  {
    name: "cv_linkedin_status",
    description:
      "Per-entry LinkedIn sync status for a variant: synced | drifted | new, comparing each position's current fingerprint " +
      "against what cv_linkedin_mark_synced last stamped — names exactly which positions are now stale on LinkedIn. Returns " +
      "{variantId, positions:[{entryId,title,company,state,syncedAt}]}. person_id required; variant_id defaults to the cv variant.",
    inputSchema: { type: "object", properties: { person_id: personId, variant_id: variantId }, required: ["person_id"], additionalProperties: false },
    handler: (a) => {
      const q = a.variant_id != null ? `?variant=${enc(a.variant_id)}` : "";
      return api("GET", `/api/persons/${enc(a.person_id)}/linkedin/status${q}`);
    },
  },
  {
    name: "cv_linkedin_mark_synced",
    description:
      "After pasting into LinkedIn, stamp the current fingerprints as synced — future cv_linkedin_status reads them as " +
      "synced until the CV changes. entry_ids limits which entries to stamp (default: all current positions). Returns {variantId, marked}.",
    inputSchema: { type: "object", properties: { person_id: personId, variant_id: variantId, entry_ids: { type: "array", items: { type: "integer" }, description: "Entry ids to mark synced (default: all current positions)" } }, required: ["person_id"], additionalProperties: false },
    handler: (a) => api("POST", `/api/persons/${enc(a.person_id)}/linkedin/mark-synced`, {
      ...(a.variant_id != null ? { variant: a.variant_id } : {}),
      ...(a.entry_ids ? { entryIds: a.entry_ids } : {}),
    }),
  },
];

// The advertised tool list (no handlers) + name→def map.
export const tools = toolDefs.map(({ handler, ...spec }) => spec);
const toolMap = new Map(toolDefs.map((t) => [t.name, t]));
export const TOOL_COUNT = toolDefs.length;

// Argument validation. The low-level MCP Server advertises schemas but does not
// enforce them, so we validate here — with @cfworker/json-schema (a zero-eval
// interpreter) because the Workers runtime forbids ajv's `new Function` codegen.
const validators = new Map(toolDefs.map((t) => [t.name, new Validator(t.inputSchema as any, "7")]));

function formatErrors(errors: Array<{ instanceLocation?: string; keyword?: string; error?: string }>): string {
  return errors.map((e) => `${e.instanceLocation || "/"} ${e.error || e.keyword || "invalid"}`.trim()).join("; ");
}

/** Validate args for a tool. Returns the @cfworker result {valid, errors}. */
export function validate(name: string, args: unknown): { valid: boolean; errors: any[] } {
  const v = validators.get(name);
  if (!v) return { valid: false, errors: [{ error: `Unknown tool: ${name}` }] };
  return v.validate(args ?? {}) as any;
}

/** Validate, then dispatch to the tool handler — rejecting before any network call. */
export async function callTool(name: string, args: any): Promise<any> {
  const def = toolMap.get(name);
  if (!def) throw new Error(`Unknown tool: ${name}`);
  const result = validate(name, args);
  if (!result.valid) throw new Error(`Invalid arguments for ${name}: ${formatErrors(result.errors as any)}`);
  return await def.handler(args ?? {});
}

export { toolDefs, toolMap };
