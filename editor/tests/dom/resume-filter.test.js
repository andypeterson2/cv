// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupFetchMock, createAppInstance } from './setup.js';

describe('Resume Filtering', () => {
  let app;
  let fetchMock;

  beforeEach(async () => {
    fetchMock = setupFetchMock();
    app = createAppInstance();
    await app.init();
  });

  it('isResumeEntry returns true by default', () => {
    expect(app.isResumeEntry('cv/experience.tex', 0)).toBe(true);
  });

  it('toggleResumeEntry flips the resume flag for an entry', () => {
    const file = 'cv/experience.tex';

    // Initialize resumeConfig sections for the file
    app.resumeConfig.sections[file] = {
      entries: [{ resume: true, items: [] }],
    };

    expect(app.isResumeEntry(file, 0)).toBe(true);
    app.toggleResumeEntry(file, 0);
    expect(app.isResumeEntry(file, 0)).toBe(false);
    app.toggleResumeEntry(file, 0);
    expect(app.isResumeEntry(file, 0)).toBe(true);
  });

  it('isResumeBullet returns true by default', () => {
    expect(app.isResumeBullet('cv/experience.tex', 0, 0)).toBe(true);
  });

  it('toggleResumeBullet flips the resume flag for an item', () => {
    const file = 'cv/experience.tex';

    app.resumeConfig.sections[file] = {
      entries: [{ resume: true, items: [true] }],
    };

    expect(app.isResumeBullet(file, 0, 0)).toBe(true);
    app.toggleResumeBullet(file, 0, 0);
    expect(app.isResumeBullet(file, 0, 0)).toBe(false);
  });

  it('getResumeText returns empty string when no config', () => {
    expect(app.getResumeText('cv/summary.tex')).toBe('');
  });

  it('setResumeText stores and retrieves resume text', () => {
    app.ensureSectionConfig = (file) => {
      if (!app.resumeConfig.sections[file]) {
        app.resumeConfig.sections[file] = { entries: [] };
      }
      return app.resumeConfig.sections[file];
    };

    app.setResumeText('cv/summary.tex', 'Short version for resume');
    expect(app.getResumeText('cv/summary.tex')).toBe('Short version for resume');
  });

  it('toggleResumeEntry persists via CVStorage', () => {
    const saveSpy = vi.spyOn(global.CVStorage, 'save');
    app.toggleResumeEntry('cv/experience.tex', 0);
    expect(saveSpy).toHaveBeenCalled();
    saveSpy.mockRestore();
  });
});
