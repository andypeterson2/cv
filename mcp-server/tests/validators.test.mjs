/**
 * Unit tests for the MCP tool catalog + argument validators.
 * Server-less and fast — imports server.mjs (transport start is guarded, so no
 * connection opens) and exercises the ajv validators directly.
 *
 * Run: npm test   (uses the Node built-in test runner — no extra deps)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toolDefs, validators, callTool } from '../server.mjs';

test('every tool has a unique name and a compiled validator', () => {
  const names = toolDefs.map((t) => t.name);
  assert.equal(new Set(names).size, names.length, 'tool names are unique');
  for (const n of names) assert.ok(validators.get(n), `missing validator for ${n}`);
});

test('the expected tool surface is present (and legacy modal tools are gone)', () => {
  const names = new Set(toolDefs.map((t) => t.name));
  for (const n of [
    'cv_health', 'cv_get_master', 'cv_create_person', 'cv_tag', 'cv_create_variant',
    'cv_set_variant_rules', 'cv_resolve_variant', 'cv_get_pdf', 'cv_suggest_tags',
    'cv_list_tag_catalog', 'cv_add_catalog_tag', 'cv_alias_tag', 'cv_expand_variant_rules',
  ]) {
    assert.ok(names.has(n), `expected tool ${n} to be present`);
  }
  assert.ok(toolDefs.length >= 20, `expected >=20 tools, got ${toolDefs.length}`);
  assert.ok(!names.has('cv_switch_to_person'), 'legacy cv_switch_to_person should be removed');
  assert.ok(!names.has('cv_import_data'), 'legacy cv_import_data should be removed');
});

test('validators reject malformed args', () => {
  const v = (name, args) => validators.get(name)(args);
  assert.equal(v('cv_health', { x: 1 }), false, 'extra prop rejected (additionalProperties:false)');
  assert.equal(v('cv_get_master', { person_id: 'x' }), false, 'non-integer id rejected');
  assert.equal(v('cv_get_master', {}), false, 'missing required person_id rejected');
  assert.equal(v('cv_create_variant', { person_id: 1, name: 'X', kind: 'bad' }), false, 'bad kind enum rejected');
  assert.equal(v('cv_tag', { target: 'section', id: 1, tags: ['x'] }), false, 'bad target enum rejected');
  assert.equal(v('cv_create_person', { name: '' }), false, 'empty name rejected (minLength)');
});

test('validators accept well-formed args', () => {
  const v = (name, args) => validators.get(name)(args);
  assert.equal(v('cv_health', {}), true);
  assert.equal(v('cv_get_master', { person_id: 3 }), true);
  assert.equal(v('cv_create_variant', { person_id: 1, name: 'FE Resume', kind: 'resume' }), true);
  assert.equal(v('cv_tag', { target: 'entry', id: 2, tags: ['frontend'] }), true);
  assert.equal(v('cv_set_variant_rules', { variant_id: 9, include: ['a'], exclude: ['b'] }), true);
});

test('callTool rejects unknown tools and invalid args before any network call', async () => {
  await assert.rejects(() => callTool('nope', {}), /Unknown tool/);
  await assert.rejects(() => callTool('cv_get_master', { person_id: 'x' }), /Invalid arguments/);
});
