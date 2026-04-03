// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupFetchMock, createAppInstance, fixtures } from './setup.js';

describe('Section Editor', () => {
  let app;
  let fetchMock;

  beforeEach(async () => {
    fetchMock = setupFetchMock();
    app = createAppInstance();
    await app.init();
  });

  it('loads document sections from localStorage state on init', () => {
    expect(app.docSections.length).toBe(3);
    expect(app.docSections.map(s => s.file)).toContain('cv/summary.tex');
    expect(app.docSections.map(s => s.file)).toContain('cv/experience.tex');
    expect(app.docSections.map(s => s.file)).toContain('cv/skills.tex');
  });

  it('docSections have enabled flag', () => {
    expect(app.docSections[0].enabled).toBe(true);
  });

  it('loadSectionData fetches section from server', async () => {
    const sec = app.docSections.find(s => s.file === 'cv/experience.tex');
    // Clear _data to force a fetch
    sec._data = null;
    sec.id = 'experience';
    await app.loadSectionData(sec);
    expect(sec._data).toBeDefined();
    expect(sec._data.type).toBe('cventries');
    expect(sec._data.entries.length).toBe(2);
    expect(sec._data.entries[0].items.length).toBe(2);
  });

  it('saveSection persists section data via CVStorage', () => {
    const sec = app.docSections[0];
    sec._data = { type: 'cvparagraph', title: 'Summary', text: 'Test' };
    const saveSpy = vi.spyOn(global.CVStorage, 'save');
    app.saveSection(sec);
    expect(saveSpy).toHaveBeenCalled();
    saveSpy.mockRestore();
  });

  it('addCventry adds an entry to section data', () => {
    const sec = app.docSections.find(s => s.file === 'cv/experience.tex');
    sec._data = {
      type: 'cventries',
      entries: [{ position: 'Existing', organization: '', location: '', date: '', items: [] }],
    };

    // Provide ensureSectionConfig if not present
    if (!app.ensureSectionConfig) {
      app.ensureSectionConfig = (file) => {
        if (!app.resumeConfig.sections[file]) {
          app.resumeConfig.sections[file] = { entries: [] };
        }
        return app.resumeConfig.sections[file];
      };
    }

    app.addCventry(sec);
    expect(sec._data.entries.length).toBe(2);
    expect(sec._data.entries[1].position).toBe('');
  });

  it('removeEntry removes an entry by index', () => {
    const sec = app.docSections.find(s => s.file === 'cv/experience.tex');
    sec._data = {
      type: 'cventries',
      entries: [
        { position: 'A', items: [] },
        { position: 'B', items: [] },
      ],
    };

    app.removeEntry(sec, 0);
    expect(sec._data.entries.length).toBe(1);
    expect(sec._data.entries[0].position).toBe('B');
  });

  it('addBullet adds an item to an entry', () => {
    const sec = app.docSections.find(s => s.file === 'cv/experience.tex');
    const entry = { position: 'Dev', items: ['existing'] };
    sec._data = { type: 'cventries', entries: [entry] };

    if (!app.ensureSectionConfig) {
      app.ensureSectionConfig = (file) => {
        if (!app.resumeConfig.sections[file]) {
          app.resumeConfig.sections[file] = { entries: [] };
        }
        return app.resumeConfig.sections[file];
      };
    }

    app.addBullet(sec, entry, 0);
    expect(entry.items.length).toBe(2);
    expect(entry.items[1]).toBe('');
  });

  it('removeBullet removes an item from an entry', () => {
    const sec = app.docSections.find(s => s.file === 'cv/experience.tex');
    const entry = { position: 'Dev', items: ['a', 'b', 'c'] };
    sec._data = { type: 'cventries', entries: [entry] };

    app.removeBullet(sec, entry, 0, 1);
    expect(entry.items.length).toBe(2);
    expect(entry.items).toEqual(['a', 'c']);
  });

  it('toggleSection flips enabled flag', () => {
    expect(app.docSections[0].enabled).toBe(true);
    app.toggleSection(0);
    expect(app.docSections[0].enabled).toBe(false);
  });
});
