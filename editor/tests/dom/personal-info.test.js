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

  it('loads personal data from localStorage state on init', () => {
    // The standalone app hydrates from CVStorage.load() which returns
    // data with personal info from fixtures
    expect(app.dataModel).toBeDefined();
    expect(app.dataModel.personal).toBeDefined();
    expect(app.dataModel.personal['personal.firstName']).toBe('Andrew');
    expect(app.dataModel.personal['personal.lastName']).toBe('Peterson');
  });

  it('saveData persists state via CVStorage', () => {
    const saveSpy = vi.spyOn(global.CVStorage, 'save');
    app.saveData();
    expect(saveSpy).toHaveBeenCalled();
    saveSpy.mockRestore();
  });

  it('togglePhoto flips photoEnabled state', () => {
    // Set up the personal reference that togglePhoto expects
    app.personal = app.dataModel.personal || { photoEnabled: '0' };
    app.personal.photoEnabled = '0';

    app.togglePhoto();
    expect(app.personal.photoEnabled).toBe('1');

    app.togglePhoto();
    expect(app.personal.photoEnabled).toBe('0');
  });

  it('getState includes personal data in dataModel', () => {
    const state = app.getState();
    expect(state.data).toBe(app.dataModel);
  });

  it('hydrate restores personal data from saved state', () => {
    const savedState = {
      data: {
        personal: {
          'personal.firstName': 'Restored',
          'personal.lastName': 'User',
        }
      },
      sectionData: {},
    };

    app.hydrate(savedState);

    expect(app.dataModel.personal['personal.firstName']).toBe('Restored');
  });
});
