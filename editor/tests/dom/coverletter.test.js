// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { setupFetchMock, createAppInstance, fixtures } from './setup.js';

describe('Cover Letter', () => {
  let app;
  let fetchMock;

  beforeEach(async () => {
    fetchMock = setupFetchMock();
    app = createAppInstance();
    // The standalone app uses DEMO_DATA for coverletter,
    // seeded via CVStorage.load() or seedFromServer().
    // Since CVStorage.load() returns null in test setup,
    // init() calls seedFromServer() which fetches /api/seed.
  });

  it('has coverletter property initialized to null before init', () => {
    // Before init, coverletter starts as null
    expect(app.coverletter).toBeNull();
  });

  it('loadCoverletter returns the coverletter data', () => {
    // Set up coverletter data like DEMO_DATA provides
    app.coverletter = {
      recipientName: 'Hiring Manager',
      recipientAddress: '456 Corporate Ave',
      title: 'Application',
      opening: 'Dear Hiring Manager,',
      closing: 'Sincerely,',
      enclosureLabel: 'Attached',
      enclosureContent: 'Resume, Portfolio',
      sections: [
        { id: 1, sort_order: 0, title: 'Introduction', body: 'Test intro.' },
        { id: 2, sort_order: 1, title: 'Experience', body: 'Test experience.' },
      ]
    };

    const cl = app.loadCoverletter();
    expect(cl).toBe(app.coverletter);
    expect(cl.recipientName).toBe('Hiring Manager');
    expect(cl.sections.length).toBe(2);
  });

  it('saveCoverletter updates coverletter and persists', () => {
    const cl = {
      recipientName: 'New HR',
      recipientAddress: '789 New St',
      title: 'New Application',
      opening: 'Hello,',
      closing: 'Best,',
      enclosureLabel: 'Enclosed',
      enclosureContent: 'CV',
      sections: [
        { id: 1, sort_order: 0, title: 'About Me', body: 'Updated.' },
      ]
    };

    app.saveCoverletter(cl);

    expect(app.coverletter).toBe(cl);
    expect(app.coverletter.recipientName).toBe('New HR');
    expect(app.coverletter.sections.length).toBe(1);
  });

  it('coverletter is included in getState()', () => {
    app.coverletter = {
      recipientName: 'HR Team',
      sections: [{ id: 1, title: 'Intro', body: 'Hello.' }]
    };

    const state = app.getState();
    expect(state.coverletter).toBe(app.coverletter);
    expect(state.coverletter.recipientName).toBe('HR Team');
  });

  it('hydrate restores coverletter from saved state', () => {
    const savedState = {
      data: { personal: {} },
      coverletter: {
        recipientName: 'Restored HR',
        sections: [{ id: 1, title: 'Restored', body: 'Content.' }]
      },
      sectionData: {},
    };

    app.hydrate(savedState);

    expect(app.coverletter.recipientName).toBe('Restored HR');
    expect(app.coverletter.sections.length).toBe(1);
  });
});
