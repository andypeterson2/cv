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

});
