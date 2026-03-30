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

  it('loads sections from API on init', () => {
    expect(app.sections.length).toBe(3);
    expect(app.sections.map(s => s.id)).toContain('experience');
    expect(app.sections.map(s => s.id)).toContain('skills');
  });

  it('loads document sections for cv variant', () => {
    expect(app.docSections.length).toBe(3);
    expect(app.docSections[0].id).toBe('summary');
    expect(app.docSections[1].id).toBe('experience');
    expect(app.docSections[2].id).toBe('skills');
  });

  it('loads section data with entries and items', async () => {
    const sec = app.docSections.find(s => s.id === 'experience');
    await app.loadSectionData(sec);
    expect(sec._data).toBeDefined();
    expect(sec._data.type).toBe('cventries');
    expect(sec._data.entries.length).toBe(2);
    expect(sec._data.entries[0].items.length).toBe(2);
  });

  it('adds entry via POST', async () => {
    const sec = app.docSections.find(s => s.id === 'experience');
    await app.loadSectionData(sec);

    await app.addEntry(sec);

    const postCalls = fetchMock.mock.calls.filter(
      ([url, opts]) => String(url).includes('/entries') && opts?.method === 'POST'
    );
    expect(postCalls.length).toBeGreaterThan(0);
  });

  it('removes entry via DELETE', async () => {
    const sec = app.docSections.find(s => s.id === 'experience');
    await app.loadSectionData(sec);

    await app.removeEntry(sec, 1);

    const delCalls = fetchMock.mock.calls.filter(
      ([url, opts]) => String(url).includes('/api/entries/1') && opts?.method === 'DELETE'
    );
    expect(delCalls.length).toBe(1);
    expect(sec._data.entries.find(e => e.id === 1)).toBeUndefined();
  });

  it('autosaves entry fields on change', async () => {
    const sec = app.docSections.find(s => s.id === 'experience');
    await app.loadSectionData(sec);

    const entry = sec._data.entries[0];
    entry.fields.position = 'Senior Engineer';
    app.autoSaveEntry(entry);

    await new Promise(r => setTimeout(r, 600));

    const putCalls = fetchMock.mock.calls.filter(
      ([url, opts]) => String(url).includes('/api/entries/') && opts?.method === 'PUT'
    );
    expect(putCalls.length).toBeGreaterThan(0);
    const body = JSON.parse(putCalls[putCalls.length - 1][1].body);
    expect(body.fields.position).toBe('Senior Engineer');
  });

  it('adds item via POST', async () => {
    const sec = app.docSections.find(s => s.id === 'experience');
    await app.loadSectionData(sec);

    const entry = sec._data.entries[0];
    await app.addItem(entry);

    expect(entry.items.length).toBe(3); // 2 original + 1 new
    expect(entry.items[2].id).toBe(99);
  });

  it('removes item via DELETE', async () => {
    const sec = app.docSections.find(s => s.id === 'experience');
    await app.loadSectionData(sec);

    const entry = sec._data.entries[0];
    await app.removeItem(entry, 10);

    const delCalls = fetchMock.mock.calls.filter(
      ([url, opts]) => String(url).includes('/api/items/10') && opts?.method === 'DELETE'
    );
    expect(delCalls.length).toBe(1);
    expect(entry.items.find(i => i.id === 10)).toBeUndefined();
  });

  it('autosaves item content on change', async () => {
    const sec = app.docSections.find(s => s.id === 'experience');
    await app.loadSectionData(sec);

    const item = sec._data.entries[0].items[0];
    item.content = 'Updated bullet';
    app.autoSaveItem(item);

    await new Promise(r => setTimeout(r, 600));

    const putCalls = fetchMock.mock.calls.filter(
      ([url, opts]) => String(url).includes('/api/items/') && opts?.method === 'PUT'
    );
    expect(putCalls.length).toBeGreaterThan(0);
    const body = JSON.parse(putCalls[putCalls.length - 1][1].body);
    expect(body.content).toBe('Updated bullet');
  });
});
