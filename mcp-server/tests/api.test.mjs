/**
 * Unit tests for the api() HTTP helper — verifies request construction and error
 * mapping with a mocked global fetch (no live cv-editor needed).
 *
 * Run: npm test   (Node built-in test runner)
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../server.mjs';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function mockFetch(response) {
  const calls = [];
  globalThis.fetch = async (url, opts) => { calls.push({ url, opts }); return response; };
  return calls;
}

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
  json: async () => body,
  text: async () => JSON.stringify(body),
});

test('GET sends no body and no Content-Type, and returns parsed JSON', async () => {
  const calls = mockFetch(jsonResponse(200, { status: 'ok' }));
  const out = await api('GET', '/api/health');
  assert.deepEqual(out, { status: 'ok' });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith('/api/health'), `url was ${calls[0].url}`);
  assert.equal(calls[0].opts.method, 'GET');
  assert.equal(calls[0].opts.body, undefined);
  assert.equal(calls[0].opts.headers['Content-Type'], undefined);
});

test('POST serializes a JSON body and sets Content-Type', async () => {
  const calls = mockFetch(jsonResponse(200, { id: 5 }));
  const out = await api('POST', '/api/persons', { name: 'Ada' });
  assert.deepEqual(out, { id: 5 });
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].opts.body), { name: 'Ada' });
});

test('a non-2xx JSON response throws with the server-provided message', async () => {
  mockFetch(jsonResponse(409, { error: 'Person with that name already exists' }));
  await assert.rejects(
    () => api('POST', '/api/persons', { name: 'dup' }),
    /HTTP 409.*already exists/,
  );
});

test('an unreachable backend yields a friendly, actionable error', async () => {
  globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
  await assert.rejects(() => api('GET', '/api/health'), /Could not reach cv-editor/);
});
