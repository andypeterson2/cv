function app() {
  return {
    activeDoc: 'cv',
    sections: [],
    docSections: [],
    personal: {},
    metrics: [],
    coverletter: { settings: {}, sections: [] },
    showPdf: false,
    compiling: false,
    compiledPdfs: { resume: '', cv: '', coverletter: '' },
    statusMsg: '',
    statusType: '',
    pdfUrl: '',
    sortable: null,
    darkMode: true,
    sidebarOpen: true,
    _saveTimers: {},

    // Modal state
    modal: { open: false, title: '', fields: [], resolve: null },

    async init() {
      this.darkMode = document.documentElement.dataset.theme !== 'light';
      await Promise.all([
        this.loadPersonal(),
        this.loadMetrics(),
        this.loadSections(),
        this.loadDocumentSections('cv'),
        this.loadCoverletter(),
      ]);
      this.$watch('activeDoc', (val) => {
        if (val !== 'coverletter') {
          this.loadDocumentSections(val);
        }
        if (this.compiledPdfs[val]) {
          this.pdfUrl = this.compiledPdfs[val];
          this.showPdf = true;
        }
      });
    },

    // ------ Theme ------

    toggleTheme() {
      this.darkMode = !this.darkMode;
      if (window.__setTheme) window.__setTheme(this.darkMode ? 'dark' : 'light');
    },

    // ------ Modal system ------

    openModal(title, fields) {
      return new Promise((resolve) => {
        this.modal = { open: true, title, fields: fields.map(f => ({ ...f, value: f.value || '' })), resolve };
      });
    },

    submitModal() {
      const result = {};
      for (const f of this.modal.fields) {
        result[f.name] = f.value;
      }
      this.modal.resolve(result);
      this.modal = { open: false, title: '', fields: [], resolve: null };
    },

    cancelModal() {
      this.modal.resolve(null);
      this.modal = { open: false, title: '', fields: [], resolve: null };
    },

    // ------ Debounced autosave ------

    debounce(key, fn, delay = 500) {
      clearTimeout(this._saveTimers[key]);
      this._saveTimers[key] = setTimeout(fn, delay);
    },

    // ------ Personal info ------

    async loadPersonal() {
      const res = await fetch(API_BASE + '/api/settings?prefix=personal');
      if (!res.ok) return;
      const data = await res.json();
      const p = {};
      for (const [key, value] of Object.entries(data)) {
        p[key.replace('personal.', '')] = value;
      }
      this.personal = p;
    },

    autoSavePersonal(field) {
      this.debounce('personal.' + field, async () => {
        await fetch(API_BASE + '/api/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ['personal.' + field]: this.personal[field] || '' }),
        });
        this.flash('Saved', 'success');
      });
    },

    togglePhoto() {
      const enabled = this.personal.photoEnabled === '1' ? '0' : '1';
      this.personal.photoEnabled = enabled;
      fetch(API_BASE + '/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 'personal.photoEnabled': enabled }),
      });
    },

    // ------ Metrics ------

    async loadMetrics() {
      const res = await fetch(API_BASE + '/api/metrics');
      if (!res.ok) return;
      this.metrics = await res.json();
    },

    metricsForSection(sectionId) {
      return this.metrics.filter(m => m.sectionId === sectionId);
    },

    metricGroupsForSection(sectionId) {
      const metrics = this.metricsForSection(sectionId);
      const groups = {};
      for (const m of metrics) {
        const g = m.groupName || 'Ungrouped';
        if (!groups[g]) groups[g] = [];
        groups[g].push(m);
      }
      return Object.entries(groups);
    },

    autoSaveMetric(metric) {
      this.debounce('metric.' + metric.id, async () => {
        await fetch(API_BASE + '/api/metrics/' + metric.id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: metric.value === '' ? null : metric.value }),
        });
        this.flash('Saved', 'success');
      });
    },

    async addMetric(sectionId, groupName) {
      const result = await this.openModal('Add Variable', [
        { name: 'command', label: 'Command name (e.g., myMetric)', value: '' },
        { name: 'label', label: 'Placeholder label', value: '' },
      ]);
      if (!result || !result.command.trim()) return;
      const res = await fetch(API_BASE + '/api/metrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: result.command.trim(),
          label: result.label.trim() || result.command.trim(),
          value: null,
          groupName,
          sectionId,
        }),
      });
      if (res.status === 409) { this.flash('Command already exists', 'error'); return; }
      if (!res.ok) { this.flash('Failed to add', 'error'); return; }
      await this.loadMetrics();
    },

    async removeMetric(metricId) {
      await fetch(API_BASE + '/api/metrics/' + metricId, { method: 'DELETE' });
      await this.loadMetrics();
    },

    async addMetricGroup(sectionId) {
      const result = await this.openModal('New Variable Group', [
        { name: 'groupName', label: 'Group name', value: '' },
        { name: 'command', label: 'First variable command name', value: '' },
        { name: 'label', label: 'Placeholder label', value: '' },
      ]);
      if (!result || !result.groupName.trim() || !result.command.trim()) return;
      const res = await fetch(API_BASE + '/api/metrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: result.command.trim(),
          label: result.label.trim() || result.command.trim(),
          value: null,
          groupName: result.groupName.trim(),
          sectionId,
        }),
      });
      if (res.status === 409) { this.flash('Command already exists', 'error'); return; }
      if (!res.ok) { this.flash('Failed to add', 'error'); return; }
      await this.loadMetrics();
    },

    async removeMetricGroup(sectionId, groupName) {
      const toRemove = this.metrics.filter(m => m.sectionId === sectionId && m.groupName === groupName);
      for (const m of toRemove) {
        await fetch(API_BASE + '/api/metrics/' + m.id, { method: 'DELETE' });
      }
      await this.loadMetrics();
    },

    async renameMetricGroup(sectionId, oldGroup) {
      const result = await this.openModal('Rename Group', [
        { name: 'groupName', label: 'New group name', value: oldGroup },
      ]);
      if (!result || !result.groupName.trim() || result.groupName.trim() === oldGroup) return;
      const toRename = this.metrics.filter(m => m.sectionId === sectionId && m.groupName === oldGroup);
      for (const m of toRename) {
        await fetch(API_BASE + '/api/metrics/' + m.id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groupName: result.groupName.trim() }),
        });
      }
      await this.loadMetrics();
    },

    // ------ Sections + Document config ------

    async loadSections() {
      const res = await fetch(API_BASE + '/api/sections');
      if (!res.ok) return;
      this.sections = await res.json();
    },

    async loadDocumentSections(variant) {
      const res = await fetch(API_BASE + '/api/documents/' + variant);
      if (!res.ok) return;
      const data = await res.json();
      // Merge with full section data
      this.docSections = [];
      for (const ds of data.sections) {
        const sec = this.sections.find(s => s.id === ds.sectionId);
        if (!sec) continue;
        this.docSections.push({
          ...sec,
          enabled: ds.enabled,
          resumeParagraphText: ds.resumeParagraphText,
          _expanded: true,
          _data: null,
        });
      }
      this.$nextTick(() => {
        this.initSortable();
        for (const sec of this.docSections) {
          if (sec.enabled) this.loadSectionData(sec);
        }
      });
    },

    async switchDoc(name) {
      this.activeDoc = name;
      if (name !== 'coverletter') {
        await this.loadDocumentSections(name);
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
          this.saveDocumentSections();
        },
      });
    },

    async saveDocumentSections() {
      const variant = this.activeDoc;
      const sections = this.docSections.map(s => ({
        sectionId: s.id,
        enabled: s.enabled,
        resumeParagraphText: s.resumeParagraphText || null,
      }));
      await fetch(API_BASE + '/api/documents/' + variant, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sections }),
      });
      this.flash('Order saved', 'success');
    },

    toggleSection(index) {
      this.docSections[index].enabled = !this.docSections[index].enabled;
      this.saveDocumentSections();
    },

    // ------ Section data (entries + items) ------

    async loadSectionData(sec) {
      if (sec._data) return;
      const res = await fetch(API_BASE + '/api/sections/' + sec.id);
      if (!res.ok) return;
      sec._data = await res.json();
      if (sec._data.type === 'cventries') {
        this.$nextTick(() => this.initBulletSortables(sec));
      }
    },

    initBulletSortables(sec) {
      this.$nextTick(() => {
        const allLists = document.querySelectorAll(`.items-list[data-sec-id="${sec.id}"]`);
        allLists.forEach(list => {
          if (list._sortable) { list._sortable.destroy(); list._sortable = null; }
          list._sortable = Sortable.create(list, {
            handle: '.ui-drag-handle',
            ghostClass: 'ui-sortable-ghost',
            chosenClass: 'ui-sortable-chosen',
            draggable: '.item-row',
            animation: 100,
            onEnd: (evt) => {
              const entryId = parseInt(list.dataset.entryId);
              const entry = sec._data.entries.find(e => e.id === entryId);
              if (!entry) return;
              const item = entry.items.splice(evt.oldIndex, 1)[0];
              entry.items.splice(evt.newIndex, 0, item);
              const ids = entry.items.map(i => i.id);
              fetch(API_BASE + '/api/entries/' + entryId + '/items/order', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids }),
              });
            },
          });
        });
      });
    },

    // ------ Entry CRUD ------

    autoSaveEntry(entry) {
      this.debounce('entry.' + entry.id, async () => {
        await fetch(API_BASE + '/api/entries/' + entry.id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: entry.fields }),
        });
        this.flash('Saved', 'success');
      });
    },

    async addEntry(sec) {
      const defaults = {};
      if (sec.type === 'cventries') {
        Object.assign(defaults, { position: '', organization: '', location: '', date: '' });
      } else if (sec.type === 'cvskills') {
        Object.assign(defaults, { category: '', skills: '' });
      } else if (sec.type === 'cvhonors') {
        Object.assign(defaults, { award: '', issuer: '', location: '', date: '' });
      } else if (sec.type === 'cvreferences') {
        Object.assign(defaults, { name: '', relation: '', phone: '', email: '' });
      } else if (sec.type === 'cvparagraph') {
        Object.assign(defaults, { text: '' });
      }
      const res = await fetch(API_BASE + '/api/sections/' + sec.id + '/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: defaults }),
      });
      if (!res.ok) { this.flash('Failed to add', 'error'); return; }
      // Reload section data
      sec._data = null;
      await this.loadSectionData(sec);
    },

    async removeEntry(sec, entryId) {
      await fetch(API_BASE + '/api/entries/' + entryId, { method: 'DELETE' });
      sec._data.entries = sec._data.entries.filter(e => e.id !== entryId);
    },

    toggleResumeEntry(entry) {
      entry.resumeIncluded = !entry.resumeIncluded;
      fetch(API_BASE + '/api/entries/' + entry.id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeIncluded: entry.resumeIncluded }),
      });
    },

    // ------ Item (bullet) CRUD ------

    autoSaveItem(item) {
      this.debounce('item.' + item.id, async () => {
        await fetch(API_BASE + '/api/items/' + item.id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: item.content }),
        });
        this.flash('Saved', 'success');
      });
    },

    async addItem(entry) {
      const res = await fetch(API_BASE + '/api/entries/' + entry.id + '/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '' }),
      });
      if (!res.ok) return;
      const data = await res.json();
      entry.items.push({ id: data.id, content: '', resumeIncluded: true, sort_order: entry.items.length, entry_id: entry.id });
    },

    async removeItem(entry, itemId) {
      await fetch(API_BASE + '/api/items/' + itemId, { method: 'DELETE' });
      entry.items = entry.items.filter(i => i.id !== itemId);
    },

    toggleResumeItem(item) {
      item.resumeIncluded = !item.resumeIncluded;
      fetch(API_BASE + '/api/items/' + item.id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeIncluded: item.resumeIncluded }),
      });
    },

    // ------ cvparagraph: autosave text + resume text ------

    autoSaveParagraph(sec) {
      const entry = sec._data.entries[0];
      if (!entry) return;
      this.debounce('para.' + entry.id, async () => {
        await fetch(API_BASE + '/api/entries/' + entry.id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: entry.fields }),
        });
        this.flash('Saved', 'success');
      });
    },

    autoSaveResumeParagraphText(sec) {
      this.debounce('rpt.' + sec.id, async () => {
        this.saveDocumentSections();
      });
    },

    // ------ Cover letter ------

    async loadCoverletter() {
      const [settingsRes, sectionsRes] = await Promise.all([
        fetch(API_BASE + '/api/settings?prefix=coverletter'),
        fetch(API_BASE + '/api/coverletter/sections'),
      ]);
      if (settingsRes.ok) {
        const data = await settingsRes.json();
        const s = {};
        for (const [key, value] of Object.entries(data)) {
          s[key.replace('coverletter.', '')] = value;
        }
        this.coverletter.settings = s;
      }
      if (sectionsRes.ok) {
        this.coverletter.sections = await sectionsRes.json();
      }
    },

    autoSaveCoverletterSetting(field) {
      this.debounce('cl.' + field, async () => {
        await fetch(API_BASE + '/api/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ['coverletter.' + field]: this.coverletter.settings[field] || '' }),
        });
        this.flash('Saved', 'success');
      });
    },

    async addCoverletterSection() {
      const res = await fetch(API_BASE + '/api/coverletter/sections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '', body: '' }),
      });
      if (!res.ok) return;
      const data = await res.json();
      this.coverletter.sections.push({ id: data.id, title: '', body: '', sort_order: this.coverletter.sections.length });
    },

    autoSaveCoverletterSection(sec) {
      this.debounce('clsec.' + sec.id, async () => {
        await fetch(API_BASE + '/api/coverletter/sections/' + sec.id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: sec.title, body: sec.body }),
        });
        this.flash('Saved', 'success');
      });
    },

    async removeCoverletterSection(secId) {
      await fetch(API_BASE + '/api/coverletter/sections/' + secId, { method: 'DELETE' });
      this.coverletter.sections = this.coverletter.sections.filter(s => s.id !== secId);
    },

    // ------ Compile & PDF ------

    async compile() {
      this.compiling = true;
      const name = this.activeDoc;
      try {
        const res = await fetch(API_BASE + '/api/compile/' + name, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          this.flash(name.charAt(0).toUpperCase() + name.slice(1) + ' compiled', 'success');
          const url = API_BASE + '/api/pdf/' + name + '?t=' + Date.now();
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
      clearTimeout(this._flashTimer);
      this._flashTimer = setTimeout(() => { this.statusMsg = ''; }, 3000);
    },
  };
}
