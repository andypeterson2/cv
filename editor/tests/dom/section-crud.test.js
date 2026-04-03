// @vitest-environment happy-dom
/**
 * DOM tests for section creation, deletion, and renaming.
 *
 * The standalone app has createNewSection, deleteSection, saveSectionTitle
 * which all require a backend connection. These tests verify the methods
 * exist and call requireBackend, and test the backend-connected path
 * by stubbing requireBackend to return true.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { setupFetchMock, createAppInstance, fixtures } from './setup.js';

describe('Section CRUD via UI', () => {
  let app;
  let fetchMock;

  beforeEach(async () => {
    fetchMock = setupFetchMock();
    app = createAppInstance();
    await app.init();
  });

  test('createNewSection exists as a method', () => {
    expect(typeof app.createNewSection).toBe('function');
  });

  test('createNewSection calls requireBackend', async () => {
    app.requireBackend = vi.fn().mockReturnValue(false);
    await app.createNewSection();
    expect(app.requireBackend).toHaveBeenCalled();
  });

  test('createNewSection with backend calls openModal and POST', async () => {
    app.requireBackend = vi.fn().mockReturnValue(true);
    app.openModal = vi.fn().mockResolvedValue({
      title: 'Education',
      type: 'cventries',
    });
    // Mock loadSections and loadDocumentSections since they fetch from server
    app.loadSections = vi.fn();
    app.loadDocumentSections = vi.fn();

    await app.createNewSection();

    // Verify POST /api/sections was called
    const createCall = fetchMock.mock.calls.find(
      ([url, opts]) => String(url).includes('/api/sections') && opts && opts.method === 'POST'
    );
    expect(createCall).toBeDefined();
    const body = JSON.parse(createCall[1].body);
    expect(body.id).toBe('education');
    expect(body.type).toBe('cventries');
    expect(body.title).toBe('Education');
  });

  test('createNewSection generates valid slug from title', async () => {
    app.requireBackend = vi.fn().mockReturnValue(true);
    app.openModal = vi.fn().mockResolvedValue({
      title: 'Work & Projects!',
      type: 'cventries',
    });
    app.loadSections = vi.fn();
    app.loadDocumentSections = vi.fn();

    await app.createNewSection();

    const createCall = fetchMock.mock.calls.find(
      ([url, opts]) => String(url).includes('/api/sections') && opts && opts.method === 'POST'
    );
    const body = JSON.parse(createCall[1].body);
    expect(body.id).toBe('work-projects');
    expect(body.id).toMatch(/^[a-z0-9-]+$/);
  });

  test('createNewSection rejects invalid type', async () => {
    app.requireBackend = vi.fn().mockReturnValue(true);
    app.openModal = vi.fn().mockResolvedValue({
      title: 'Bad Section',
      type: 'invalidtype',
    });

    await app.createNewSection();

    const createCall = fetchMock.mock.calls.find(
      ([url, opts]) => String(url).includes('/api/sections') && opts && opts.method === 'POST'
    );
    expect(createCall).toBeUndefined();
  });

  test('createNewSection does nothing when modal is cancelled', async () => {
    app.requireBackend = vi.fn().mockReturnValue(true);
    app.openModal = vi.fn().mockResolvedValue(null);

    await app.createNewSection();

    const createCall = fetchMock.mock.calls.find(
      ([url, opts]) => String(url).includes('/api/sections') && opts && opts.method === 'POST'
    );
    expect(createCall).toBeUndefined();
  });

  test('deleteSection calls requireBackend', async () => {
    app.requireBackend = vi.fn().mockReturnValue(false);
    await app.deleteSection('experience');
    expect(app.requireBackend).toHaveBeenCalled();
  });

  test('deleteSection calls DELETE /api/sections/:id when confirmed', async () => {
    app.requireBackend = vi.fn().mockReturnValue(true);
    global.confirm = vi.fn().mockReturnValue(true);
    app.loadSections = vi.fn();
    app.loadDocumentSections = vi.fn();

    await app.deleteSection('experience');

    const deleteCall = fetchMock.mock.calls.find(
      ([url, opts]) => String(url).includes('/api/sections/experience') && opts && opts.method === 'DELETE'
    );
    expect(deleteCall).toBeDefined();
  });

  test('deleteSection does nothing when confirm is declined', async () => {
    app.requireBackend = vi.fn().mockReturnValue(true);
    global.confirm = vi.fn().mockReturnValue(false);

    await app.deleteSection('experience');

    const deleteCall = fetchMock.mock.calls.find(
      ([url, opts]) => String(url).includes('/api/sections/experience') && opts && opts.method === 'DELETE'
    );
    expect(deleteCall).toBeUndefined();
  });

  test('saveSectionTitle calls PUT /api/sections/:id', async () => {
    app.requireBackend = vi.fn().mockReturnValue(true);
    app.docSections = [{ id: 'experience', title: 'Experience' }];

    await app.saveSectionTitle('experience', 'Work History');

    const renameCall = fetchMock.mock.calls.find(
      ([url, opts]) => String(url).includes('/api/sections/experience') && opts && opts.method === 'PUT'
    );
    expect(renameCall).toBeDefined();
    const body = JSON.parse(renameCall[1].body);
    expect(body.title).toBe('Work History');
  });
});
