// @vitest-environment happy-dom
/**
 * Modal-related tests for the standalone CV editor.
 *
 * The standalone app.js defines createNewSection() which calls openModal(),
 * but openModal/submitModal/cancelModal are provided by Alpine.js mixins
 * in the full website build. The standalone app has the *call sites* but
 * not the implementations. These tests verify that the standalone app
 * handles the absence gracefully and that the function signatures exist
 * where expected.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupFetchMock, createAppInstance, fixtures } from './setup.js';

describe('Modal System (standalone)', () => {
  let app;
  let fetchMock;

  beforeEach(async () => {
    fetchMock = setupFetchMock();
    app = createAppInstance();
    await app.init();
  });

  it('createNewSection exists as a method', () => {
    expect(typeof app.createNewSection).toBe('function');
  });

  it('createNewSection calls requireBackend if defined', async () => {
    // The standalone app has createNewSection which calls requireBackend()
    // When requireBackend returns false (no backend), it should bail out early
    app.requireBackend = vi.fn().mockReturnValue(false);
    await app.createNewSection();
    expect(app.requireBackend).toHaveBeenCalled();
  });

  it('deleteSection exists as a method', () => {
    expect(typeof app.deleteSection).toBe('function');
  });

  it('deleteSection calls requireBackend if defined', async () => {
    app.requireBackend = vi.fn().mockReturnValue(false);
    await app.deleteSection('experience');
    expect(app.requireBackend).toHaveBeenCalled();
  });
});
