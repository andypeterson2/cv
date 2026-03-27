function app() {
  return {
    activeDoc: 'cv',
    docSections: [],
    dataModel: null,
    resumeConfig: { sectionOrder: [], sections: {} },
    coverletter: null,
    sectionData: {},
    showPdf: false,
    compiling: false,
    compiledPdfs: { resume: '', cv: '', coverletter: '' },
    statusMsg: '',
    statusType: '',
    pdfUrl: '',
    sortable: null,
    darkMode: true,
    sidebarOpen: true,
    seeded: false,

    // ====== Lifecycle ======

    async init() {
      this.darkMode = document.documentElement.dataset.theme !== 'light';

      // Try loading from localStorage first
      const saved = CVStorage.load();
      if (saved && saved.data && saved.sectionData) {
        this.hydrate(saved);
        this.seeded = true;
      } else {
        // First visit — seed from server
        await this.seedFromServer();
      }

      this.renderDocument();

      this.$watch('activeDoc', (val) => {
        if (this.compiledPdfs[val]) {
          this.pdfUrl = this.compiledPdfs[val];
          this.showPdf = true;
        }
      });
    },

    hydrate(state) {
      this.dataModel = state.data || { personal: {}, metrics: [] };
      this.resumeConfig = state.resumeConfig || { sectionOrder: [], sections: {} };
      this.coverletter = state.coverletter || null;
      this.sectionData = state.sectionData || {};
      // docSections from document.sections
      if (state.document && state.document.sections) {
        this.docSections = state.document.sections.map(s => ({
          ...s,
          _expanded: true,
          _data: this.sectionData[s.file] || null
        }));
      }
    },

    async seedFromServer() {
      try {
        const res = await fetch(API_BASE + '/api/seed');
        if (!res.ok) throw new Error('Seed failed: ' + res.status);
        const state = await res.json();
        this.hydrate(state);
        this.seeded = true;
        this.persist();
        this.flash('Loaded from server', 'success');
      } catch (e) {
        console.error('Seed failed:', e);
        this.flash('Failed to load from server', 'error');
      }
    },

    // ====== Persistence ======

    getState() {
      return {
        data: this.dataModel,
        resumeConfig: this.resumeConfig,
        coverletter: this.coverletter,
        document: {
          sections: this.docSections.map(s => ({
            file: s.file, enabled: s.enabled, comment: s.comment || ''
          }))
        },
        sectionData: this.sectionData
      };
    },

    persist() {
      CVStorage.save(this.getState());
    },

    exportData() {
      CVStorage.exportJSON(this.getState());
    },

    async importData() {
      try {
        const state = await CVStorage.importJSON();
        if (!state || !state.data) {
          this.flash('Invalid file — missing data', 'error');
          return;
        }
        this.hydrate(state);
        this.renderDocument();
        this.persist();
        this.flash('Imported successfully', 'success');
      } catch (e) {
        this.flash(e.message || 'Import failed', 'error');
      }
    },

    async resetFromServer() {
      if (!confirm('Reset all local data from server? This will overwrite your local changes.')) return;
      CVStorage.clear();
      await this.seedFromServer();
      this.renderDocument();
    },

    // ====== Theme ======

    toggleTheme() {
      this.darkMode = !this.darkMode;
      if (window.__setTheme) window.__setTheme(this.darkMode ? 'dark' : 'light');
    },

    // ====== Data (personal info + metrics) ======

    saveData() {
      this.persist();
    },

    togglePhoto() {
      if (!this.dataModel.personal.photo) {
        this.dataModel.personal.photo = { enabled: true, file: 'profile' };
      } else {
        this.dataModel.personal.photo.enabled = !this.dataModel.personal.photo.enabled;
      }
      this.persist();
    },

    metricsForSection(file) {
      if (!this.dataModel) return [];
      return this.dataModel.metrics.filter(m => m.section === file);
    },

    metricGroupsForSection(file) {
      const metrics = this.metricsForSection(file);
      const groups = {};
      for (const m of metrics) {
        const g = m.group || 'Ungrouped';
        if (!groups[g]) groups[g] = [];
        groups[g].push(m);
      }
      return Object.entries(groups);
    },

    updateMetric(command, value) {
      const metric = this.dataModel.metrics.find(m => m.command === command);
      if (metric) {
        metric.value = value === '' ? null : value;
        this.persist();
      }
    },

    addMetric(section, group) {
      const command = prompt('Variable command name (e.g., myMetric):');
      if (!command || !command.trim()) return;
      const cmd = command.trim();
      if (this.dataModel.metrics.some(m => m.command === cmd)) {
        this.flash('Variable command already exists', 'error');
        return;
      }
      const label = prompt('Placeholder label (shown when empty):', cmd) || cmd;
      this.dataModel.metrics.push({
        command: cmd, label: label.trim(), value: null,
        group: group, section: section
      });
      this.persist();
    },

    removeMetric(command) {
      const idx = this.dataModel.metrics.findIndex(m => m.command === command);
      if (idx !== -1) {
        this.dataModel.metrics.splice(idx, 1);
        this.persist();
      }
    },

    addMetricGroup(section) {
      const name = prompt('New variable group name:');
      if (!name || !name.trim()) return;
      this.dataModel.metrics.push({
        command: '', label: '', value: null,
        group: name.trim(), section: section
      });
      const command = prompt('First variable command name:');
      if (command && command.trim()) {
        const cmd = command.trim();
        if (this.dataModel.metrics.some(m => m.command === cmd && m !== this.dataModel.metrics[this.dataModel.metrics.length - 1])) {
          this.flash('Variable command already exists', 'error');
          this.dataModel.metrics.pop();
          return;
        }
        const label = prompt('Placeholder label:', cmd) || cmd;
        const last = this.dataModel.metrics[this.dataModel.metrics.length - 1];
        last.command = cmd;
        last.label = label.trim();
      } else {
        this.dataModel.metrics.pop();
        return;
      }
      this.persist();
    },

    removeMetricGroup(section, group) {
      this.dataModel.metrics = this.dataModel.metrics.filter(
        m => !(m.section === section && m.group === group)
      );
      this.persist();
    },

    renameMetricGroup(section, oldGroup) {
      const newName = prompt('Rename group:', oldGroup);
      if (!newName || !newName.trim() || newName.trim() === oldGroup) return;
      for (const m of this.dataModel.metrics) {
        if (m.section === section && m.group === oldGroup) {
          m.group = newName.trim();
        }
      }
      this.persist();
    },

    // ====== Resume Config ======

    saveResumeConfig() {
      this.persist();
    },

    ensureSectionConfig(file) {
      if (!this.resumeConfig.sections[file]) {
        this.resumeConfig.sections[file] = { resume: true, entries: [] };
      }
      return this.resumeConfig.sections[file];
    },

    isResumeSection(file) {
      const cfg = this.resumeConfig.sections[file];
      return cfg ? cfg.resume !== false : true;
    },

    toggleResumeSection(file) {
      const cfg = this.ensureSectionConfig(file);
      cfg.resume = !cfg.resume;
      if (cfg.resume) {
        if (!this.resumeConfig.sectionOrder.includes(file)) {
          this.resumeConfig.sectionOrder.push(file);
        }
      } else {
        this.resumeConfig.sectionOrder = this.resumeConfig.sectionOrder.filter(f => f !== file);
      }
      this.persist();
    },

    isResumeEntry(file, ei) {
      const cfg = this.resumeConfig.sections[file];
      if (!cfg || !cfg.entries || !cfg.entries[ei]) return true;
      return cfg.entries[ei].resume !== false;
    },

    toggleResumeEntry(file, ei) {
      const cfg = this.ensureSectionConfig(file);
      while (cfg.entries.length <= ei) {
        cfg.entries.push({ resume: true, items: [] });
      }
      cfg.entries[ei].resume = !cfg.entries[ei].resume;
      this.persist();
    },

    isResumeBullet(file, ei, ii) {
      const cfg = this.resumeConfig.sections[file];
      if (!cfg || !cfg.entries || !cfg.entries[ei] || !cfg.entries[ei].items) return true;
      return cfg.entries[ei].items[ii] !== false;
    },

    toggleResumeBullet(file, ei, ii) {
      const cfg = this.ensureSectionConfig(file);
      while (cfg.entries.length <= ei) {
        cfg.entries.push({ resume: true, items: [] });
      }
      while (cfg.entries[ei].items.length <= ii) {
        cfg.entries[ei].items.push(true);
      }
      cfg.entries[ei].items[ii] = !cfg.entries[ei].items[ii];
      this.persist();
    },

    getResumeText(file) {
      const cfg = this.resumeConfig.sections[file];
      return cfg ? (cfg.resumeText || '') : '';
    },

    setResumeText(file, text) {
      const cfg = this.ensureSectionConfig(file);
      cfg.resumeText = text;
      this.persist();
    },

    // ====== Document (section list) ======

    renderDocument() {
      // Build docSections from stored state, attaching section data
      if (!this.docSections.length) return;
      for (const sec of this.docSections) {
        sec._data = this.sectionData[sec.file] || null;
      }
      this.$nextTick(() => {
        this.initSortable();
        for (const sec of this.docSections) {
          if (sec._data && sec._data.type === 'cventries') {
            this.initBulletSortables(sec);
          }
        }
      });
    },

    switchDoc(name) {
      this.activeDoc = name;
      if (this.compiledPdfs[name]) {
        this.pdfUrl = this.compiledPdfs[name];
        this.showPdf = true;
      }
    },

    initSortable() {
      if (this.sortable) this.sortable.destroy();
      const el = document.getElementById('section-list');
      if (!el) return;
      this.sortable = Sortable.create(el, {
        handle: '.ui-drag-handle',
        ghostClass: 'ui-sortable-ghost',
        chosenClass: 'ui-sortable-chosen',
        animation: 150,
        onEnd: (evt) => {
          const item = this.docSections.splice(evt.oldIndex, 1)[0];
          this.docSections.splice(evt.newIndex, 0, item);
          this.persist();
          this.flash('Section order saved', 'success');
        }
      });
    },

    initBulletSortables(sec) {
      this.$nextTick(() => {
        const allLists = document.querySelectorAll('.items-list[data-entry-idx]');
        allLists.forEach(list => {
          if (list.dataset.secFile !== sec.file) return;
          if (list._sortable) { list._sortable.destroy(); list._sortable = null; }
          list._sortable = Sortable.create(list, {
            handle: '.ui-drag-handle',
            ghostClass: 'ui-sortable-ghost',
            chosenClass: 'ui-sortable-chosen',
            draggable: '.item-row',
            animation: 100,
            onEnd: (evt) => {
              const ei = parseInt(list.dataset.entryIdx);
              const entry = sec._data.entries[ei];
              if (!entry) return;
              const item = entry.items.splice(evt.oldIndex, 1)[0];
              entry.items.splice(evt.newIndex, 0, item);
              const cfg = this.resumeConfig.sections[sec.file];
              if (cfg && cfg.entries && cfg.entries[ei] && cfg.entries[ei].items) {
                const flag = cfg.entries[ei].items.splice(evt.oldIndex, 1)[0];
                cfg.entries[ei].items.splice(evt.newIndex, 0, flag !== undefined ? flag : true);
              }
              this.persist();
            }
          });
        });
      });
    },

    toggleSection(index) {
      this.docSections[index].enabled = !this.docSections[index].enabled;
      this.persist();
    },

    sectionTitle(file) {
      const name = file.split('/').pop().replace('.tex', '');
      return name.charAt(0).toUpperCase() + name.slice(1);
    },

    // ====== Section editing ======

    saveSection(sec) {
      // Section data is already in sectionData via _data reference
      this.sectionData[sec.file] = sec._data;
      this.persist();
      this.flash('Section saved', 'success');
    },

    addCventry(sec) {
      sec._data.entries.push({
        position: '', organization: '', location: '', date: '', items: ['']
      });
      const cfg = this.ensureSectionConfig(sec.file);
      cfg.entries.push({ resume: true, items: [true] });
      this.persist();
    },

    removeEntry(sec, index) {
      sec._data.entries.splice(index, 1);
      const cfg = this.resumeConfig.sections[sec.file];
      if (cfg && cfg.entries) {
        cfg.entries.splice(index, 1);
      }
      this.persist();
    },

    addBullet(sec, entry, ei) {
      entry.items.push('');
      const cfg = this.ensureSectionConfig(sec.file);
      while (cfg.entries.length <= ei) {
        cfg.entries.push({ resume: true, items: [] });
      }
      cfg.entries[ei].items.push(true);
      this.persist();
    },

    removeBullet(sec, entry, ei, ii) {
      entry.items.splice(ii, 1);
      const cfg = this.resumeConfig.sections[sec.file];
      if (cfg && cfg.entries && cfg.entries[ei] && cfg.entries[ei].items) {
        cfg.entries[ei].items.splice(ii, 1);
      }
      this.persist();
    },

    // ====== Cover letter ======

    loadCoverletter() {
      return this.coverletter;
    },

    saveCoverletter(cl) {
      this.coverletter = cl;
      this.persist();
      this.flash('Cover letter saved', 'success');
    },

    // ====== Compile & PDF ======

    async compile() {
      this.compiling = true;
      const name = this.activeDoc;
      try {
        const res = await fetch(`${API_BASE}/api/compile/${name}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.getState())
        });
        const result = await res.json();
        if (result.success) {
          this.flash(`${name.charAt(0).toUpperCase() + name.slice(1)} compiled`, 'success');
          const url = `${API_BASE}/api/pdf/${name}?t=${Date.now()}`;
          this.compiledPdfs[name] = url;
          this.pdfUrl = url;
          this.showPdf = true;
        } else {
          this.flash('Compilation failed - check console', 'error');
          console.error(result.log);
        }
      } catch (e) {
        this.flash('Compilation error', 'error');
      }
      this.compiling = false;
    },

    // ====== UI helpers ======

    flash(msg, type) {
      this.statusMsg = msg;
      this.statusType = type === 'success' ? 'ui-alert-success' : type === 'error' ? 'ui-alert-danger' : '';
      clearTimeout(this._flashTimer);
      this._flashTimer = setTimeout(() => { this.statusMsg = ''; }, 3000);
    }
  };
}
