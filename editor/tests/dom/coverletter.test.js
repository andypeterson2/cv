// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { setupFetchMock, createAppInstance, fixtures } from './setup.js';

describe('Cover Letter', () => {
  let app;
  let fetchMock;

  beforeEach(async () => {
    fetchMock = setupFetchMock();
    app = createAppInstance();
    await app.init();
  });

  it('loads coverletter settings on init', () => {
    expect(app.coverletter.settings.recipientName).toBe('HR Team');
    expect(app.coverletter.settings.recipientAddress).toBe('123 Main St');
    expect(app.coverletter.settings.title).toBe('Application');
    expect(app.coverletter.settings.opening).toBe('Dear Team,');
    expect(app.coverletter.settings.closing).toBe('Sincerely,');
    expect(app.coverletter.settings.enclosureLabel).toBe('Attached');
    expect(app.coverletter.settings.enclosureContent).toBe('Resume');
  });

  it('loads coverletter sections on init', () => {
    expect(app.coverletter.sections.length).toBe(2);
    expect(app.coverletter.sections[0].title).toBe('About Me');
    expect(app.coverletter.sections[0].body).toBe('I am a software engineer.');
    expect(app.coverletter.sections[1].title).toBe('Why Me?');
  });

  it('autoSaveCoverletterSetting sends PATCH with prefixed key', async () => {
    app.coverletter.settings.recipientName = 'New HR';
    app.autoSaveCoverletterSetting('recipientName');

    await new Promise(r => setTimeout(r, 600));

    const patchCalls = fetchMock.mock.calls.filter(
      ([url, opts]) => String(url).includes('/api/settings') && opts?.method === 'PATCH'
    );
    expect(patchCalls.length).toBeGreaterThan(0);
    const body = JSON.parse(patchCalls[patchCalls.length - 1][1].body);
    expect(body['coverletter.recipientName']).toBe('New HR');
  });

  it('addCoverletterSection appends a new section', async () => {
    await app.addCoverletterSection();

    expect(app.coverletter.sections.length).toBe(3);
    const last = app.coverletter.sections[2];
    expect(last.id).toBeDefined();
    expect(last.title).toBe('');
    expect(last.body).toBe('');
  });

  it('addCoverletterSection sends POST', async () => {
    await app.addCoverletterSection();

    const postCalls = fetchMock.mock.calls.filter(
      ([url, opts]) => String(url).includes('/api/coverletter/sections') && opts?.method === 'POST'
    );
    expect(postCalls.length).toBe(1);
  });

  it('removeCoverletterSection removes by id', async () => {
    await app.removeCoverletterSection(1);

    expect(app.coverletter.sections.length).toBe(1);
    expect(app.coverletter.sections[0].id).toBe(2);
  });

  it('removeCoverletterSection sends DELETE', async () => {
    await app.removeCoverletterSection(1);

    const delCalls = fetchMock.mock.calls.filter(
      ([url, opts]) => String(url).includes('/api/coverletter/sections/1') && opts?.method === 'DELETE'
    );
    expect(delCalls.length).toBe(1);
  });

  it('autoSaveCoverletterSection sends PUT with title and body', async () => {
    const sec = app.coverletter.sections[0];
    sec.title = 'Updated Title';
    sec.body = 'Updated body text.';
    app.autoSaveCoverletterSection(sec);

    await new Promise(r => setTimeout(r, 600));

    const putCalls = fetchMock.mock.calls.filter(
      ([url, opts]) => String(url).includes('/api/coverletter/sections/1') && opts?.method === 'PUT'
    );
    expect(putCalls.length).toBe(1);
    const body = JSON.parse(putCalls[0][1].body);
    expect(body.title).toBe('Updated Title');
    expect(body.body).toBe('Updated body text.');
  });
});
