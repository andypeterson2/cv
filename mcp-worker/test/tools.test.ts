/// <reference types="@cloudflare/vitest-pool-workers" />
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tools, toolDefs, callTool, validate, TOOL_COUNT } from '../src/tools';
import { cvCtx } from '../src/cv-ctx';

// Parity coverage moved from cv/mcp-server/tests/validators.test.mjs (Node) to the
// Worker runtime — proves the tool catalog + the Workers-safe validator behave
// like the stdio server before that server is deleted.
describe('cv tool catalog (moved into the Worker)', () => {
  it('exposes exactly 69 tools, each cv_*-prefixed with a description + schema', () => {
    expect(TOOL_COUNT).toBe(69);
    expect(tools.length).toBe(69);
    for (const t of tools) {
      expect(t.name).toMatch(/^cv_/);
      expect(typeof t.description).toBe('string');
      expect(t.inputSchema).toBeTruthy();
    }
  });

  it('has unique tool names', () => {
    const names = toolDefs.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('includes the canonical surface (legacy modal tools are gone)', () => {
    const names = new Set(tools.map((t) => t.name));
    for (const n of [
      'cv_health',
      'cv_get_main',
      'cv_create_profile',
      'cv_tag',
      'cv_create_variant',
      'cv_set_variant_rules',
      'cv_resolve_variant',
      'cv_get_pdf',
      'cv_suggest_tags',
      'cv_expand_variant_rules',
      'cv_export_linkedin',
      'cv_linkedin_status',
      'cv_linkedin_mark_synced',
    ]) {
      expect(names.has(n)).toBe(true);
    }
    expect(names.has('cv_switch_to_profile')).toBe(false);
    expect(names.has('cv_import_data')).toBe(false);
  });

  it('rejects malformed args (via @cfworker/json-schema, zero-eval / Workers-safe)', () => {
    expect(validate('cv_health', { x: 1 }).valid).toBe(false); // additionalProperties:false
    expect(validate('cv_get_main', { profile_id: 'x' }).valid).toBe(false); // non-integer id
    expect(validate('cv_get_main', {}).valid).toBe(false); // missing required
    // Bad enums, an empty name (minLength), and a missing profile_id.
    expect(validate('cv_create_variant', { profile_id: 1, name: 'X', kind: 'bad' }).valid).toBe(
      false,
    );
    expect(validate('cv_tag', { target: 'section', id: 1, tags: ['x'] }).valid).toBe(false);
    expect(validate('cv_create_profile', { name: '' }).valid).toBe(false);
    expect(validate('cv_export_linkedin', {}).valid).toBe(false);
    expect(validate('cv_export_linkedin', { profile_id: 5, format: 'bad' }).valid).toBe(false);
  });

  it('accepts well-formed args', () => {
    expect(validate('cv_health', {}).valid).toBe(true);
    expect(validate('cv_get_main', { profile_id: 3 }).valid).toBe(true);
    expect(
      validate('cv_create_variant', { profile_id: 1, name: 'FE Resume', kind: 'resume' }).valid,
    ).toBe(true);
    expect(validate('cv_tag', { target: 'entry', id: 2, tags: ['frontend'] }).valid).toBe(true);
    expect(
      validate('cv_set_variant_rules', { variant_id: 9, include: ['a'], exclude: ['b'] }).valid,
    ).toBe(true);
    expect(
      validate('cv_export_linkedin', { profile_id: 5, variant_id: 10, format: 'markdown' }).valid,
    ).toBe(true);
    expect(
      validate('cv_linkedin_mark_synced', { profile_id: 5, entry_ids: [244, 245] }).valid,
    ).toBe(true);
    expect(
      validate('cv_set_variant_settings', {
        variant_id: 19,
        settings: { 'spacing.contentTopAdjust': { num: -2, unit: 'mm' }, 'style.fontFamily': null },
      }).valid,
    ).toBe(true);
    expect(validate('cv_set_variant_settings', { variant_id: 19, settings: {} }).valid).toBe(false);
    expect(validate('cv_install_layout', { url: 'http://x.test/a.zip' }).valid).toBe(false);
    expect(validate('cv_install_layout', { url: 'https://x.test/a.zip' }).valid).toBe(true);
    expect(validate('cv_check_layout', { url: 'https://x.test/a.zip' }).valid).toBe(true);
    expect(validate('cv_review_layout', { layout_id: 'u1-a@1', decision: 'maybe' }).valid).toBe(
      false,
    );
    expect(
      validate('cv_review_layout', { layout_id: 'u1-a@1', decision: 'approve', note: 'ok' }).valid,
    ).toBe(true);
  });

  it('callTool rejects unknown tools + invalid args before any network call', async () => {
    await expect(callTool('nope', {})).rejects.toThrow(/Unknown tool/);
    await expect(callTool('cv_get_main', { profile_id: 'x' })).rejects.toThrow(/Invalid arguments/);
  });
});

// Per-user scoping: every cv call carries the caller's verified
// X-User-Id (from the async context set at dispatch) + the front-door secret — and no
// shared owner token. cv trusts that header only behind the secret and scopes by it.
describe('per-user scoping — cv calls carry a verified X-User-Id', () => {
  let calls: Array<{ url: string; headers: Headers }>;
  beforeEach(() => {
    calls = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init: any) => {
      calls.push({ url: String(input), headers: new Headers(init?.headers) });
      return new Response(JSON.stringify({ profiles: [] }), {
        headers: { 'content-type': 'application/json' },
      });
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('injects X-User-Id + X-Origin-Secret, and NOT the owner token', async () => {
    await cvCtx.run({ cvUserId: 7 }, () => callTool('cv_list_profiles', {}));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toMatch(/\/api\/profiles$/);
    expect(calls[0].headers.get('x-user-id')).toBe('7');
    expect(calls[0].headers.get('x-origin-secret')).toBe('test-origin-secret');
    expect(calls[0].headers.get('authorization')).toBeNull(); // the shared owner token is gone
  });

  it('cv_set_variant_settings PATCHes the variant settings route', async () => {
    await cvCtx.run({ cvUserId: 7 }, () =>
      callTool('cv_set_variant_settings', {
        variant_id: 19,
        settings: { 'spacing.marginTop': null },
      }),
    );
    expect(calls[0].url).toMatch(/\/api\/variants\/19\/settings$/);
  });

  it('scopes to whoever is in context — a different id is sent verbatim', async () => {
    await cvCtx.run({ cvUserId: 42 }, () => callTool('cv_list_profiles', {}));
    expect(calls[0].headers.get('x-user-id')).toBe('42');
  });

  it('refuses a cv call with no authenticated user in context (no request made)', async () => {
    await expect(callTool('cv_list_profiles', {})).rejects.toThrow(/No authenticated cv user/);
    expect(calls).toHaveLength(0);
  });
});
