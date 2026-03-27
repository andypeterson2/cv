/**
 * CV Editor — localStorage persistence + JSON file export/import.
 *
 * The browser holds the full CV state as JSON. The server is only contacted
 * for initial seed (parse .tex files) and compilation (JSON → PDF).
 */
const CVStorage = (function () {
  'use strict';

  const KEY = 'cv-editor-state';

  /** Load state from localStorage. Returns null if nothing stored. */
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.error('CVStorage.load failed:', e);
      return null;
    }
  }

  /** Persist state to localStorage. */
  function save(state) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      console.error('CVStorage.save failed:', e);
    }
  }

  /** Clear stored state. */
  function clear() {
    localStorage.removeItem(KEY);
  }

  /** Download state as a .json file. */
  function exportJSON(state) {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cv-data.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Import a .json file and return the parsed state.
   * Returns a Promise that resolves with the state object.
   */
  function importJSON() {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = () => {
        const file = input.files[0];
        if (!file) return reject(new Error('No file selected'));
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const state = JSON.parse(reader.result);
            resolve(state);
          } catch (e) {
            reject(new Error('Invalid JSON file'));
          }
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsText(file);
      };
      input.click();
    });
  }

  return { load, save, clear, exportJSON, importJSON };
})();
