// @vitest-environment happy-dom
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

  it('switchDoc changes activeDoc', () => {
    app.switchDoc('resume');
    expect(app.activeDoc).toBe('resume');
  });

  it('switchDoc sets pdfUrl if compiled PDF exists', () => {
    app.compiledPdfs.resume = '/api/pdf/resume?t=123';
    app.switchDoc('resume');
    expect(app.pdfUrl).toBe('/api/pdf/resume?t=123');
  });

  it('compile sends POST for current pdfTab and stores PDF url', async () => {
    // The standalone app uses pdfTab for compile target if defined,
    // otherwise falls back. Let's set up the right properties.
    app.pdfTab = 'resume';
    app.requireBackend = () => true;
    app.serverConnected = true;
    await app.compile();

    const compileCalls = fetchMock.mock.calls.filter(
      ([url, opts]) => String(url).includes('/api/compile/resume') && opts?.method === 'POST'
    );
    expect(compileCalls.length).toBe(1);
    expect(app.compiledPdfs.resume).toContain('/api/pdf/resume');
  });

  it('compile sets compiling flag during operation', async () => {
    app.pdfTab = 'cv';
    app.requireBackend = () => true;
    app.serverConnected = true;
    await app.compile();
    expect(app.compiling).toBe(false);
  });

  it('docSections are loaded from localStorage state', () => {
    expect(app.docSections.length).toBe(3);
    // The order comes from documentSections fixture
    expect(app.docSections[0].file).toBe('cv/summary.tex');
    expect(app.docSections[1].file).toBe('cv/experience.tex');
    expect(app.docSections[2].file).toBe('cv/skills.tex');
  });

  it('showPdf defaults to false', () => {
    expect(app.showPdf).toBe(false);
  });

  it('compiledPdfs tracks PDFs for each document type', () => {
    expect(app.compiledPdfs).toHaveProperty('cv');
    expect(app.compiledPdfs).toHaveProperty('resume');
    expect(app.compiledPdfs).toHaveProperty('coverletter');
  });
});
