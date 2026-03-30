// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { setupFetchMock, createAppInstance } from './setup.js';

describe('Modal System', () => {
  let app;
  let fetchMock;

  beforeEach(async () => {
    fetchMock = setupFetchMock();
    app = createAppInstance();
    await app.init();
  });

  it('modal starts closed', () => {
    expect(app.modal.open).toBe(false);
    expect(app.modal.title).toBe('');
    expect(app.modal.fields).toEqual([]);
    expect(app.modal.resolve).toBeNull();
  });

  it('openModal sets modal state and returns a promise', () => {
    const promise = app.openModal('Test Title', [
      { name: 'field1', label: 'Field 1' },
      { name: 'field2', label: 'Field 2', value: 'preset' },
    ]);

    expect(promise).toBeInstanceOf(Promise);
    expect(app.modal.open).toBe(true);
    expect(app.modal.title).toBe('Test Title');
    expect(app.modal.fields.length).toBe(2);
    expect(app.modal.fields[0].name).toBe('field1');
    expect(app.modal.fields[0].value).toBe('');
    expect(app.modal.fields[1].value).toBe('preset');
  });

  it('submitModal resolves with field values and closes', async () => {
    const promise = app.openModal('Submit Test', [
      { name: 'command', label: 'Command' },
      { name: 'label', label: 'Label' },
    ]);

    // Simulate user filling in fields
    app.modal.fields[0].value = 'myCommand';
    app.modal.fields[1].value = 'My Label';

    app.submitModal();

    const result = await promise;
    expect(result).toEqual({ command: 'myCommand', label: 'My Label' });
    expect(app.modal.open).toBe(false);
    expect(app.modal.title).toBe('');
    expect(app.modal.fields).toEqual([]);
  });

  it('cancelModal resolves with null and closes', async () => {
    const promise = app.openModal('Cancel Test', [
      { name: 'name', label: 'Name' },
    ]);

    app.cancelModal();

    const result = await promise;
    expect(result).toBeNull();
    expect(app.modal.open).toBe(false);
  });

  it('addMetric opens modal and sends POST on submit', async () => {
    // Start addMetric in background — it will open modal and wait
    const addPromise = app.addMetric('experience', 'General');

    // Modal should be open
    expect(app.modal.open).toBe(true);
    expect(app.modal.title).toBe('Add Variable');
    expect(app.modal.fields.length).toBe(2);

    // Fill in and submit
    app.modal.fields[0].value = 'newMetric';
    app.modal.fields[1].value = 'New Label';
    app.submitModal();

    await addPromise;

    const postCalls = fetchMock.mock.calls.filter(
      ([url, opts]) => String(url).includes('/api/metrics') && opts?.method === 'POST'
    );
    expect(postCalls.length).toBe(1);
    const body = JSON.parse(postCalls[0][1].body);
    expect(body.command).toBe('newMetric');
    expect(body.label).toBe('New Label');
    expect(body.groupName).toBe('General');
    expect(body.sectionId).toBe('experience');
  });

  it('addMetric does nothing when modal is cancelled', async () => {
    const callsBefore = fetchMock.mock.calls.length;
    const addPromise = app.addMetric('experience', 'General');

    app.cancelModal();
    await addPromise;

    const postCalls = fetchMock.mock.calls.slice(callsBefore).filter(
      ([url, opts]) => String(url).includes('/api/metrics') && opts?.method === 'POST'
    );
    expect(postCalls.length).toBe(0);
  });

  it('addMetricGroup opens modal with 3 fields', async () => {
    const addPromise = app.addMetricGroup('experience');

    expect(app.modal.open).toBe(true);
    expect(app.modal.title).toBe('New Variable Group');
    expect(app.modal.fields.length).toBe(3);
    expect(app.modal.fields[0].name).toBe('groupName');
    expect(app.modal.fields[1].name).toBe('command');
    expect(app.modal.fields[2].name).toBe('label');

    // Cancel to resolve
    app.cancelModal();
    await addPromise;
  });

  it('addMetricGroup sends POST on submit', async () => {
    const addPromise = app.addMetricGroup('experience');

    app.modal.fields[0].value = 'New Group';
    app.modal.fields[1].value = 'groupMetric';
    app.modal.fields[2].value = 'Group Label';
    app.submitModal();

    await addPromise;

    const postCalls = fetchMock.mock.calls.filter(
      ([url, opts]) => String(url).includes('/api/metrics') && opts?.method === 'POST'
    );
    expect(postCalls.length).toBe(1);
    const body = JSON.parse(postCalls[0][1].body);
    expect(body.groupName).toBe('New Group');
    expect(body.command).toBe('groupMetric');
  });

  it('renameMetricGroup opens modal with current name prefilled', async () => {
    const renamePromise = app.renameMetricGroup('experience', 'General');

    expect(app.modal.open).toBe(true);
    expect(app.modal.title).toBe('Rename Group');
    expect(app.modal.fields[0].value).toBe('General');

    app.cancelModal();
    await renamePromise;
  });
});
