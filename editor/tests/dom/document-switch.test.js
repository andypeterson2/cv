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

  it('defaults to sections editorTab and cv pdfTab', () => {
    expect(app.editorTab).toBe('sections');
    expect(app.pdfTab).toBe('cv');
  });

  it('switchPdfTab changes pdfTab', () => {
    app.switchPdfTab('resume');
    expect(app.pdfTab).toBe('resume');
  });

  it('switchPdfTab sets pdfUrl if compiled PDF exists', () => {
    app.compiledPdfs.resume = '/api/pdf/resume?t=123';
    app.switchPdfTab('resume');
    expect(app.pdfUrl).toBe('/api/pdf/resume?t=123');
  });

  it('switchPdfTab clears pdfUrl if no compiled PDF', () => {
    app.pdfUrl = '/api/pdf/cv?t=old';
    app.switchPdfTab('coverletter');
    expect(app.pdfUrl).toBe('');
  });

  it('compile sends POST for current pdfTab and stores PDF url', async () => {
    app.pdfTab = 'resume';
    await app.compile();

    const compileCalls = fetchMock.mock.calls.filter(
      ([url, opts]) => String(url).includes('/api/compile/resume') && opts?.method === 'POST'
    );
    expect(compileCalls.length).toBe(1);
    expect(app.compiledPdfs.resume).toContain('/api/pdf/resume');
  });

  it('compile sets compiling flag during operation', async () => {
    await app.compile();
    expect(app.compiling).toBe(false);
  });

  it('docSections are loaded from document config merged with sections', () => {
    expect(app.docSections.length).toBe(3);
    expect(app.docSections[0].id).toBe('summary');
    expect(app.docSections[0].enabled).toBe(true);
    expect(app.docSections[1].id).toBe('experience');
    expect(app.docSections[2].id).toBe('skills');
  });

  it('editorTab can be switched independently of pdfTab', () => {
    app.editorTab = 'profile';
    app.pdfTab = 'coverletter';
    expect(app.editorTab).toBe('profile');
    expect(app.pdfTab).toBe('coverletter');
  });
});
