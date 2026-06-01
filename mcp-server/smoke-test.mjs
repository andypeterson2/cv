#!/usr/bin/env node
/**
 * Smoke test for the cv-editor MCP server (stateless model).
 *
 * Spawns server.mjs over stdio, completes the MCP handshake, lists tools, and
 * drives a full create → tag → variant → resolve → cleanup round-trip against a
 * running cv-editor. No active-person/switch state is involved.
 *
 * Run: node smoke-test.mjs   (requires the cv-editor REST API to be up)
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const child = spawn(process.execPath, [join(here, 'server.mjs')], { stdio: ['pipe', 'pipe', 'inherit'], env: process.env });

let buffer = '';
const pending = new Map();
let nextId = 1;

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  let nl;
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    const cb = pending.get(msg.id);
    if (cb) { pending.delete(msg.id); cb(msg); }
  }
});

function send(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${JSON.stringify(msg.error)}`)) : resolve(msg.result)));
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
function notify(method, params) { child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'); }
const call = (name, args = {}) => send('tools/call', { name, arguments: args });
const json = (r) => JSON.parse(r.content[0].text);

const checks = [];
function check(label, ok, detail = '') {
  checks.push({ label, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
}

try {
  const init = await send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke', version: '0.2.0' } });
  check('initialize', !!init.serverInfo, `${init.serverInfo?.name}@${init.serverInfo?.version}`);
  notify('notifications/initialized', {});

  const list = await send('tools/list', {});
  const names = list.tools.map((t) => t.name);
  check('tools/list returns >=20 tools', list.tools.length >= 20, `got ${list.tools.length}`);
  for (const t of ['cv_get_master', 'cv_tag', 'cv_create_variant', 'cv_set_variant_rules', 'cv_resolve_variant', 'cv_get_pdf']) {
    check(`${t} present`, names.includes(t));
  }
  check('old modal tools removed', !names.includes('cv_switch_to_person') && !names.includes('cv_import_data'));

  const health = await call('cv_health');
  check('cv_health -> status:ok', !health.isError && /"status"\s*:\s*"ok"/.test(health.content[0].text));

  // Validator surface
  const reject = async (label, name, args, pat) => {
    const r = await call(name, args);
    check(label, r.isError === true && pat.test(r.content?.[0]?.text ?? ''));
  };
  await reject('cv_health rejects extra args', 'cv_health', { x: 1 }, /Invalid arguments/);
  await reject('cv_get_master rejects non-integer id', 'cv_get_master', { person_id: 'x' }, /Invalid arguments/);
  await reject('cv_create_variant rejects bad kind', 'cv_create_variant', { person_id: 1, name: 'X', kind: 'bad' }, /Invalid arguments/);

  // Round-trip: create → content → tag → variant → rules → resolve → cleanup
  const stamp = (init.serverInfo?.version || '') + '-' + Math.floor(performance.now());
  const pid = json(await call('cv_create_person', { name: `mcp-smoke-${stamp}` })).id;
  check('cv_create_person', Number.isInteger(pid), `id=${pid}`);

  const sid = json(await call('cv_add_section', { person_id: pid, slug: 'experience', type: 'experience', title: 'Experience' })).id;
  const e1 = json(await call('cv_add_entry', { section_id: sid, fields: { position: 'Engineer' } })).id;
  const e2 = json(await call('cv_add_entry', { section_id: sid, fields: { position: 'Intern' } })).id;
  json(await call('cv_add_bullet', { entry_id: e1, content: 'Built the thing' }));
  check('content created', Number.isInteger(sid) && Number.isInteger(e1) && Number.isInteger(e2));

  const tagRes = await call('cv_tag', { target: 'entry', id: e1, tags: ['frontend'] });
  check('cv_tag entry', !tagRes.isError);

  const vid = json(await call('cv_create_variant', { person_id: pid, name: 'FE Resume', kind: 'resume' })).id;
  await call('cv_set_variant_rules', { variant_id: vid, include: ['frontend'] });

  const resolved = json(await call('cv_resolve_variant', { variant_id: vid }));
  const exp = resolved.sections.find((s) => s.id === 'experience');
  const onlyEngineer = exp && exp.entries.length === 1 && exp.entries[0].fields.position === 'Engineer';
  check('cv_resolve_variant filters by tag', onlyEngineer, `entries=${exp?.entries.length}`);

  const master = json(await call('cv_get_master', { person_id: pid }));
  check('cv_get_master returns stable ids + variant', master.sections?.[0]?.id === sid && master.variants?.length === 1);

  const del = await call('cv_delete_person', { person_id: pid });
  check('cv_delete_person cleans up', !del.isError);
} finally {
  child.kill();
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
