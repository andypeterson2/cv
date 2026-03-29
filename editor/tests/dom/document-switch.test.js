import { describe, it, expect, beforeEach } from 'vitest';
import { setupFetchMock, createAppInstance } from './setup.js';

describe('Document Switching', () => {
  let app;
  let fetchMock;

  beforeEach(async () => {
    fetchMock = setupFetchMock();
    app = createAppInstance();
    await app.init();
  });

  it('defaults to cv activeDoc', () => {
    expect(app.activeDoc).toBe('cv');
  });

  it('switchDoc changes activeDoc', async () => {
    await app.switchDoc('resume');
    expect(app.activeDoc).toBe('resume');
  });

  it('switchDoc to resume reloads document sections', async () => {
    await app.switchDoc('resume');

    const docCalls = fetchMock.mock.calls.filter(
      ([url]) => String(url).includes('/api/documents/resume')
    );
    expect(docCalls.length).toBeGreaterThan(0);
  });

  it('switchDoc to coverletter does not reload document sections', async () => {
    const callsBefore = fetchMock.mock.calls.length;
    await app.switchDoc('coverletter');

    // Should not call /api/documents/coverletter (cover letter data loaded on init)
    const docCalls = fetchMock.mock.calls.slice(callsBefore).filter(
      ([url]) => String(url).includes('/api/documents/coverletter')
    );
    expect(docCalls.length).toBe(0);
  });

  it('switchDoc sets pdfUrl if compiled PDF exists', async () => {
    app.compiledPdfs.resume = '/api/pdf/resume?t=123';
    await app.switchDoc('resume');

    expect(app.pdfUrl).toBe('/api/pdf/resume?t=123');
    expect(app.showPdf).toBe(true);
  });

  it('compile sends POST and stores PDF url', async () => {
    await app.compile();

    const compileCalls = fetchMock.mock.calls.filter(
      ([url, opts]) => String(url).includes('/api/compile/cv') && opts?.method === 'POST'
    );
    expect(compileCalls.length).toBe(1);
    expect(app.compiledPdfs.cv).toContain('/api/pdf/cv');
    expect(app.showPdf).toBe(true);
  });

  it('compile sets compiling flag during operation', async () => {
    // compiling should be false after compile completes
    await app.compile();
    expect(app.compiling).toBe(false);
  });

  it('docSections are loaded from document config merged with sections', () => {
    expect(app.docSections.length).toBe(3);
    // Should have section properties merged with document config
    expect(app.docSections[0].id).toBe('summary');
    expect(app.docSections[0].enabled).toBe(true);
    expect(app.docSections[1].id).toBe('experience');
    expect(app.docSections[2].id).toBe('skills');
  });
});
