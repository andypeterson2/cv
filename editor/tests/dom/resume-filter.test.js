// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { setupFetchMock, createAppInstance } from './setup.js';

describe('Resume Filtering', () => {
  let app;
  let fetchMock;

  beforeEach(async () => {
    fetchMock = setupFetchMock();
    app = createAppInstance();
    await app.init();
  });

  it('entries have resumeIncluded flag from API', async () => {
    const sec = app.docSections.find(s => s.id === 'experience');
    await app.loadSectionData(sec);

    expect(sec._data.entries[0].resumeIncluded).toBe(true);
    expect(sec._data.entries[1].resumeIncluded).toBe(false);
  });

  it('toggleResumeEntry flips the flag', async () => {
    const sec = app.docSections.find(s => s.id === 'experience');
    await app.loadSectionData(sec);

    const entry = sec._data.entries[0];
    expect(entry.resumeIncluded).toBe(true);

    app.toggleResumeEntry(entry);
    expect(entry.resumeIncluded).toBe(false);
  });

  it('toggleResumeEntry sends PUT with resumeIncluded', async () => {
    const sec = app.docSections.find(s => s.id === 'experience');
    await app.loadSectionData(sec);

    const entry = sec._data.entries[0];
    app.toggleResumeEntry(entry);

    await new Promise(r => setTimeout(r, 50));

    const putCalls = fetchMock.mock.calls.filter(
      ([url, opts]) => String(url).includes('/api/entries/') && opts?.method === 'PUT'
    );
    expect(putCalls.length).toBeGreaterThan(0);
    const body = JSON.parse(putCalls[putCalls.length - 1][1].body);
    expect(body.resumeIncluded).toBe(false);
  });

  it('items have resumeIncluded flag', async () => {
    const sec = app.docSections.find(s => s.id === 'experience');
    await app.loadSectionData(sec);

    expect(sec._data.entries[0].items[0].resumeIncluded).toBe(true);
  });

  it('toggleResumeItem flips the item flag', async () => {
    const sec = app.docSections.find(s => s.id === 'experience');
    await app.loadSectionData(sec);

    const item = sec._data.entries[0].items[0];
    app.toggleResumeItem(item);
    expect(item.resumeIncluded).toBe(false);
  });

  it('toggleResumeItem sends PUT with resumeIncluded', async () => {
    const sec = app.docSections.find(s => s.id === 'experience');
    await app.loadSectionData(sec);

    const item = sec._data.entries[0].items[0];
    app.toggleResumeItem(item);

    await new Promise(r => setTimeout(r, 50));

    const putCalls = fetchMock.mock.calls.filter(
      ([url, opts]) => String(url).includes('/api/items/') && opts?.method === 'PUT'
    );
    expect(putCalls.length).toBeGreaterThan(0);
    const body = JSON.parse(putCalls[putCalls.length - 1][1].body);
    expect(body.resumeIncluded).toBe(false);
  });
});
