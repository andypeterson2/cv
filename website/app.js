function app() {
  return {
    activeDoc: 'resume',
    docSections: [],
    dataModel: null,
    resumeConfig: { sectionOrder: [], sections: {} },
    showPdf: false,
    compiling: false,
    compiledPdfs: { resume: '', cv: '', coverletter: '' },
    statusMsg: '',
    statusType: '',
    pdfUrl: '',
    sortable: null,
    darkMode: true,
    sidebarOpen: true,

    async init() {
      this.darkMode = document.documentElement.dataset.theme !== 'light';
      await Promise.all([
        this.loadData(),
        this.loadResumeConfig()
      ]);
      await this.loadDocument('cv');
      this.$watch('activeDoc', (val) => {
        if (this.compiledPdfs[val]) {
          this.pdfUrl = this.compiledPdfs[val];
          this.showPdf = true;
        }
      });
    },

    // ------ Theme ------

    toggleTheme() {
      this.darkMode = !this.darkMode;
      window.__setTheme(this.darkMode ? 'dark' : 'light');
    },

    // ------ Data (personal info + metrics from data.json) ------

    async loadData() {
      const res = await fetch(API_BASE + '/api/data');
      this.dataModel = await res.json();
    },

    async saveData() {
      const res = await fetch(API_BASE + '/api/data', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.dataModel)
      });
      const data = await res.json();
      this.flash(data.success ? 'Data saved' : 'Save failed', data.success ? 'success' : 'error');
    },

    togglePhoto() {
      if (!this.dataModel.personal.photo) {
        this.dataModel.personal.photo = { enabled: true, file: 'profile' };
      } else {
        this.dataModel.personal.photo.enabled = !this.dataModel.personal.photo.enabled;
      }
      this.saveData();
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
        this.saveData();
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
        command: cmd,
        label: label.trim(),
        value: null,
        group: group,
        section: section
      });
      this.saveData();
    },

    removeMetric(command) {
      const idx = this.dataModel.metrics.findIndex(m => m.command === command);
      if (idx !== -1) {
        this.dataModel.metrics.splice(idx, 1);
        this.saveData();
      }
    },

    addMetricGroup(section) {
      const name = prompt('New variable group name:');
      if (!name || !name.trim()) return;
      this.dataModel.metrics.push({
        command: '',
        label: '',
        value: null,
        group: name.trim(),
        section: section
      });
      const command = prompt('First variable command name:');
      if (command && command.trim()) {
        const cmd = command.trim();
        if (this.dataModel.metrics.some(m => m.command === cmd)) {
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
      this.saveData();
    },

    removeMetricGroup(section, group) {
      this.dataModel.metrics = this.dataModel.metrics.filter(
        m => !(m.section === section && m.group === group)
      );
      this.saveData();
    },

    renameMetricGroup(section, oldGroup) {
      const newName = prompt('Rename group:', oldGroup);
      if (!newName || !newName.trim() || newName.trim() === oldGroup) return;
      for (const m of this.dataModel.metrics) {
        if (m.section === section && m.group === oldGroup) {
          m.group = newName.trim();
        }
      }
      this.saveData();
    },

    // ------ Resume Config ------

    async loadResumeConfig() {
      const res = await fetch(API_BASE + '/api/resume-config');
      this.resumeConfig = await res.json();
    },

    async saveResumeConfig() {
      await fetch(API_BASE + '/api/resume-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.resumeConfig)
      });
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
      this.saveResumeConfig();
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
      this.saveResumeConfig();
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
      this.saveResumeConfig();
    },

    getResumeText(file) {
      const cfg = this.resumeConfig.sections[file];
      return cfg ? (cfg.resumeText || '') : '';
    },

    setResumeText(file, text) {
      const cfg = this.ensureSectionConfig(file);
      cfg.resumeText = text;
      this.saveResumeConfig();
    },

    // ------ Document (section list) ------

    async loadDocument(name) {
      const res = await fetch(`${API_BASE}/api/document/${name}`);
      const doc = await res.json();
      this.docSections = doc.sections.map(s => ({ ...s, _expanded: true, _data: null }));
      this.$nextTick(() => {
        this.initSortable();
        for (const sec of this.docSections) {
          if (sec.enabled || this.isResumeSection(sec.file)) this.loadSectionData(sec);
        }
      });
    },

    async switchDoc(name) {
      const wasCV = this.activeDoc !== 'coverletter';
      const isCV = name !== 'coverletter';
      this.activeDoc = name;
      if (!wasCV && isCV) {
        await this.loadDocument('cv');
      }
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
          this.saveSectionOrder();
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
                this.saveResumeConfig();
              }
            }
          });
        });
      });
    },

    async saveSectionOrder() {
      const sections = this.docSections.map(s => ({
        file: s.file, enabled: s.enabled, comment: s.comment
      }));
      const res = await fetch(API_BASE + '/api/document/cv/sections', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sections })
      });
      const data = await res.json();
      this.flash(data.success ? 'Section order saved' : 'Save failed', data.success ? 'success' : 'error');
    },

    async toggleSection(index) {
      this.docSections[index].enabled = !this.docSections[index].enabled;
      await this.saveSectionOrder();
    },

    sectionTitle(file) {
      const name = file.split('/').pop().replace('.tex', '');
      return name.charAt(0).toUpperCase() + name.slice(1);
    },

    // ------ Section editing ------

    async loadSectionData(sec) {
      if (sec._data) {
        if (sec._data.type === 'cventries') this.initBulletSortables(sec);
        return;
      }
      const res = await fetch(`${API_BASE}/api/section/${sec.file}`);
      sec._data = await res.json();
      if (sec._data.type === 'cventries') {
        this.initBulletSortables(sec);
      }
    },

    async saveSection(sec) {
      const res = await fetch(`${API_BASE}/api/section/${sec.file}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sec._data)
      });
      const data = await res.json();
      this.flash(data.success ? 'Section saved' : 'Save failed', data.success ? 'success' : 'error');
    },

    addCventry(sec) {
      sec._data.entries.push({
        position: '',
        organization: '',
        location: '',
        date: '',
        items: ['']
      });
      const cfg = this.ensureSectionConfig(sec.file);
      cfg.entries.push({ resume: true, items: [true] });
      this.saveResumeConfig();
    },

    removeEntry(sec, index) {
      sec._data.entries.splice(index, 1);
      const cfg = this.resumeConfig.sections[sec.file];
      if (cfg && cfg.entries) {
        cfg.entries.splice(index, 1);
        this.saveResumeConfig();
      }
    },

    addBullet(sec, entry, ei) {
      entry.items.push('');
      const cfg = this.ensureSectionConfig(sec.file);
      while (cfg.entries.length <= ei) {
        cfg.entries.push({ resume: true, items: [] });
      }
      cfg.entries[ei].items.push(true);
      this.saveResumeConfig();
    },

    removeBullet(sec, entry, ei, ii) {
      entry.items.splice(ii, 1);
      const cfg = this.resumeConfig.sections[sec.file];
      if (cfg && cfg.entries && cfg.entries[ei] && cfg.entries[ei].items) {
        cfg.entries[ei].items.splice(ii, 1);
        this.saveResumeConfig();
      }
    },

    // ------ Cover letter ------

    async saveCoverletter(cl) {
      const res = await fetch(API_BASE + '/api/coverletter', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cl)
      });
      const data = await res.json();
      this.flash(data.success ? 'Cover letter saved' : 'Save failed', data.success ? 'success' : 'error');
    },

    // ------ Compile & PDF ------

    async compile() {
      this.compiling = true;
      const name = this.activeDoc;
      try {
        const res = await fetch(`${API_BASE}/api/compile/${name}`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          this.flash(`${name.charAt(0).toUpperCase() + name.slice(1)} compiled`, 'success');
          const url = `${API_BASE}/api/pdf/${name}?t=${Date.now()}`;
          this.compiledPdfs[name] = url;
          this.pdfUrl = url;
          this.showPdf = true;
        } else {
          this.flash('Compilation failed - check console', 'error');
          console.error(data.log);
        }
      } catch (e) {
        this.flash('Compilation error', 'error');
      }
      this.compiling = false;
    },

    // ------ UI helpers ------

    flash(msg, type) {
      this.statusMsg = msg;
      this.statusType = type === 'success' ? 'ui-alert-success' : type === 'error' ? 'ui-alert-danger' : '';
      setTimeout(() => { this.statusMsg = ''; }, 3000);
    }
  };
}
