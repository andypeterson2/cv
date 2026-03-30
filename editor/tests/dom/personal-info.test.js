// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupFetchMock, createAppInstance, fixtures } from './setup.js';

describe('Personal Info', () => {
  let app;
  let fetchMock;

  beforeEach(async () => {
    fetchMock = setupFetchMock();
    app = createAppInstance();
    await app.init();
  });

  it('loads personal data from API on init', () => {
    expect(app.personal.firstName).toBe('Andrew');
    expect(app.personal.lastName).toBe('Peterson');
    expect(app.personal.email).toBe('test@example.com');
    expect(app.personal.position).toBe('Software Engineer');
  });

  it('loads all personal fields', () => {
    expect(app.personal.github).toBe('andrewp');
    expect(app.personal.linkedin).toBe('andrewp');
    expect(app.personal.mobile).toBe('555-1234');
    expect(app.personal.address).toBe('San Diego, CA');
  });

  it('calls PATCH /api/settings when autoSavePersonal is triggered', async () => {
    app.personal.firstName = 'Andy';
    app.autoSavePersonal('firstName');

    // Wait for debounce
    await new Promise(r => setTimeout(r, 600));

    const patchCalls = fetchMock.mock.calls.filter(
      ([url, opts]) => String(url).includes('/api/settings') && opts?.method === 'PATCH'
    );
    expect(patchCalls.length).toBeGreaterThan(0);
    const body = JSON.parse(patchCalls[patchCalls.length - 1][1].body);
    expect(body['personal.firstName']).toBe('Andy');
  });

  it('toggles photo enabled state', () => {
    expect(app.personal.photoEnabled).toBe('0');
    app.togglePhoto();
    expect(app.personal.photoEnabled).toBe('1');
    app.togglePhoto();
    expect(app.personal.photoEnabled).toBe('0');
  });

  it('sends PATCH when toggling photo', async () => {
    app.togglePhoto();
    await new Promise(r => setTimeout(r, 50));

    const patchCalls = fetchMock.mock.calls.filter(
      ([url, opts]) => String(url).includes('/api/settings') && opts?.method === 'PATCH'
    );
    const body = JSON.parse(patchCalls[patchCalls.length - 1][1].body);
    expect(body['personal.photoEnabled']).toBe('1');
  });
});
