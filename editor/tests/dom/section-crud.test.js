// @vitest-environment happy-dom
/**
 * DOM tests for section creation, deletion, and renaming.
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

  test('createNewSection calls POST /api/sections and reloads', async () => {
    // Mock the modal to return section details
    app.openModal = vi.fn().mockResolvedValue({
      title: 'Education',
      type: 'cventries',
    });

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

    // Verify document sections were updated (PUT /api/documents/cv)
    const docCall = fetchMock.mock.calls.find(
      ([url, opts]) => String(url).includes('/api/documents/cv') && opts && opts.method === 'PUT'
    );
    expect(docCall).toBeDefined();
    const docBody = JSON.parse(docCall[1].body);
    const newSec = docBody.sections.find(s => s.sectionId === 'education');
    expect(newSec).toBeDefined();
    expect(newSec.enabled).toBe(true);
  });

  test('createNewSection generates valid slug from title', async () => {
    app.openModal = vi.fn().mockResolvedValue({
      title: 'Work & Projects!',
      type: 'cventries',
    });

    await app.createNewSection();

    const createCall = fetchMock.mock.calls.find(
      ([url, opts]) => String(url).includes('/api/sections') && opts && opts.method === 'POST'
    );
    const body = JSON.parse(createCall[1].body);
    expect(body.id).toBe('work-projects');
    expect(body.id).toMatch(/^[a-z0-9_-]+$/);
  });

  test('createNewSection rejects invalid type', async () => {
    app.openModal = vi.fn().mockResolvedValue({
      title: 'Bad Section',
      type: 'invalidtype',
    });

    await app.createNewSection();

    // Should not have called POST /api/sections
    const createCall = fetchMock.mock.calls.find(
      ([url, opts]) => String(url).includes('/api/sections') && opts && opts.method === 'POST'
    );
    expect(createCall).toBeUndefined();
  });

  test('createNewSection does nothing when modal is cancelled', async () => {
    app.openModal = vi.fn().mockResolvedValue(null);

    await app.createNewSection();

    const createCall = fetchMock.mock.calls.find(
      ([url, opts]) => String(url).includes('/api/sections') && opts && opts.method === 'POST'
    );
    expect(createCall).toBeUndefined();
  });

  test('deleteSection calls DELETE /api/sections/:id', async () => {
    // Mock confirm to return true
    global.confirm = vi.fn().mockReturnValue(true);

    await app.deleteSection('experience');

    const deleteCall = fetchMock.mock.calls.find(
      ([url, opts]) => String(url).includes('/api/sections/experience') && opts && opts.method === 'DELETE'
    );
    expect(deleteCall).toBeDefined();
  });

  test('deleteSection does nothing when confirm is declined', async () => {
    global.confirm = vi.fn().mockReturnValue(false);

    await app.deleteSection('experience');

    const deleteCall = fetchMock.mock.calls.find(
      ([url, opts]) => String(url).includes('/api/sections/experience') && opts && opts.method === 'DELETE'
    );
    expect(deleteCall).toBeUndefined();
  });

  test('renameSection calls PUT /api/sections/:id with new title', async () => {
    app.openModal = vi.fn().mockResolvedValue({ title: 'Work History' });

    await app.renameSection('experience');

    const renameCall = fetchMock.mock.calls.find(
      ([url, opts]) => String(url).includes('/api/sections/experience') && opts && opts.method === 'PUT'
    );
    expect(renameCall).toBeDefined();
    const body = JSON.parse(renameCall[1].body);
    expect(body.title).toBe('Work History');
  });

  test('all five section types are accepted', async () => {
    const types = ['cventries', 'cvskills', 'cvhonors', 'cvreferences', 'cvparagraph'];
    for (const type of types) {
      fetchMock.mockClear();
      app.openModal = vi.fn().mockResolvedValue({ title: type, type });
      await app.createNewSection();

      const createCall = fetchMock.mock.calls.find(
        ([url, opts]) => String(url).includes('/api/sections') && opts && opts.method === 'POST'
      );
      expect(createCall).toBeDefined();
      const body = JSON.parse(createCall[1].body);
      expect(body.type).toBe(type);
    }
  });
});
