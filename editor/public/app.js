var DEMO_DATA = {
  personal: {
    firstName: 'Jane', lastName: 'Doe',
    position: 'Senior Software Engineer',
    address: '123 Main Street, Anytown, ST 12345',
    mobile: '(555) 123-4567', email: 'jane.doe@example.com',
    homepage: 'janedoe.dev',
    github: 'janedoe', linkedin: 'janedoe', gitlab: 'janedoe',
    twitter: 'janedoe', orcid: '0000-0001-2345-6789',
    quote: 'Building the future, one commit at a time.',
    photoEnabled: '0', photoFile: '',
  },
  sections: [
    {
      id: 'summary', type: 'cvparagraph', title: 'Summary',
      entries: [{ id: 1, section_id: 'summary', sort_order: 0, resumeIncluded: true,
        fields: { text: 'Experienced software engineer with over 6 years of experience building scalable web applications and distributed systems. Passionate about clean code, mentoring, and continuous learning.' },
        items: [] }]
    },
    {
      id: 'experience', type: 'cventries', title: 'Experience',
      entries: [
        { id: 2, section_id: 'experience', sort_order: 0, resumeIncluded: true,
          fields: { position: 'Senior Software Engineer', organization: 'Acme Technologies', location: 'San Francisco, CA', date: '2022 -- Present' },
          items: [
            { id: 1, entry_id: 2, sort_order: 0, content: 'Led migration of monolithic architecture to microservices, reducing deployment time by 60\\%', resumeIncluded: true },
            { id: 2, entry_id: 2, sort_order: 1, content: 'Mentored team of 4 junior engineers through code reviews and pair programming sessions', resumeIncluded: true },
          ]
        },
        { id: 3, section_id: 'experience', sort_order: 1, resumeIncluded: true,
          fields: { position: 'Software Engineer', organization: 'Widget Corp', location: 'Austin, TX', date: '2019 -- 2022' },
          items: [
            { id: 3, entry_id: 3, sort_order: 0, content: 'Designed and implemented RESTful API serving 10,000 requests per second', resumeIncluded: true },
            { id: 4, entry_id: 3, sort_order: 1, content: 'Developed automated testing pipeline reducing QA cycle from 2 weeks to 3 days', resumeIncluded: true },
          ]
        }
      ]
    },
    {
      id: 'education', type: 'cventries', title: 'Education',
      entries: [
        { id: 4, section_id: 'education', sort_order: 0, resumeIncluded: true,
          fields: { position: 'B.S. Computer Science', organization: 'State University', location: 'Anytown, ST', date: '2015 -- 2019' },
          items: [
            { id: 5, entry_id: 4, sort_order: 0, content: 'Graduated magna cum laude, GPA 3.8/4.0', resumeIncluded: true },
          ]
        }
      ]
    },
    {
      id: 'skills', type: 'cvskills', title: 'Skills',
      entries: [
        { id: 5, section_id: 'skills', sort_order: 0, resumeIncluded: true, fields: { category: 'Languages', skills: 'JavaScript, Python, Go, Rust, SQL' }, items: [] },
        { id: 6, section_id: 'skills', sort_order: 1, resumeIncluded: true, fields: { category: 'Frameworks', skills: 'React, Node.js, Express, Django' }, items: [] },
        { id: 7, section_id: 'skills', sort_order: 2, resumeIncluded: true, fields: { category: 'Tools', skills: 'Docker, Kubernetes, Git, CI/CD, AWS' }, items: [] },
      ]
    },
  ],
  documents: {
    cv: [
      { sectionId: 'summary', enabled: true, sortOrder: 0, resumeParagraphText: null },
      { sectionId: 'experience', enabled: true, sortOrder: 1, resumeParagraphText: null },
      { sectionId: 'education', enabled: true, sortOrder: 2, resumeParagraphText: null },
      { sectionId: 'skills', enabled: true, sortOrder: 3, resumeParagraphText: null },
    ],
    resume: [
      { sectionId: 'summary', enabled: true, sortOrder: 0, resumeParagraphText: 'Software engineer with 6 years of experience in web applications and distributed systems.' },
      { sectionId: 'experience', enabled: true, sortOrder: 1, resumeParagraphText: null },
      { sectionId: 'skills', enabled: true, sortOrder: 2, resumeParagraphText: null },
    ]
  },
  coverletter: {
    recipientName: 'Hiring Manager',
    recipientAddress: '456 Corporate Ave, Business City, ST 67890',
    title: 'Application for Software Engineer Position',
    opening: 'Dear Hiring Manager,',
    closing: 'Sincerely,',
    enclosureLabel: 'Attached',
    enclosureContent: 'Resume, Portfolio',
    sections: [
      { id: 1, sort_order: 0, title: 'Introduction', body: 'I am writing to express my interest in the Software Engineer position at your company. With over six years of experience in building scalable systems, I am confident I would be a strong addition to your team.' },
      { id: 2, sort_order: 1, title: 'Experience', body: 'In my current role at Acme Technologies, I have led the migration of a monolithic application to a microservices architecture, resulting in significant improvements in deployment speed and system reliability.' },
    ]
  }
};

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
      this.dataModel = state.data || { personal: {} };
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

    // ====== Data (personal info) ======

    saveData() {
      this.persist();
    },

    togglePhoto() {
      const enabled = this.personal.photoEnabled === '1' ? '0' : '1';
      this.personal.photoEnabled = enabled;
      if (!this.serverConnected) return;
      fetch(API_BASE + '/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 'personal.photoEnabled': enabled }),
      });
    },

    // ------ Style settings ------

    async loadStyle() {
      const res = await fetch(API_BASE + '/api/settings?prefix=style');
      if (!res.ok) return;
      const data = await res.json();
      for (const [key, value] of Object.entries(data)) {
        const field = key.replace('style.', '');
        if (field in this.style) {
          this.style[field] = value;
        }
      }
      this.persist();
    },

    autoSaveStyle(field) {
      this.debounce('style.' + field, async () => {
        await fetch(API_BASE + '/api/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ['style.' + field]: this.style[field] || '' }),
        });
        this.flash('Saved', 'success');
      });
    },

    setAccentColor(preset) {
      this.style.accentColor = preset;
      this.style.customHex = '';
      this.autoSaveStyle('accentColor');
    },

    applyCustomColor() {
      const hex = this.style.customHex.trim();
      if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
        this.style.accentColor = hex;
        this.autoSaveStyle('accentColor');
      }
    },

    // ------ Section CRUD ------

    async createNewSection() {
      if (!this.requireBackend()) return;
      var result = await this.openModal('New Section', [
        { name: 'title', label: 'Section title', value: '' },
        { name: 'type', label: 'Type (cventries, cvskills, cvhonors, cvreferences, cvparagraph)', value: 'cventries' },
      ]);
      if (!result || !result.title.trim()) return;
      var id = result.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (!id) { this.flash('Invalid title', 'error'); return; }
      var validTypes = ['cventries', 'cvskills', 'cvhonors', 'cvreferences', 'cvparagraph'];
      var type = result.type.trim();
      if (validTypes.indexOf(type) === -1) { this.flash('Invalid type', 'error'); return; }
      var res = await fetch(API_BASE + '/api/sections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: id, type: type, title: result.title.trim() }),
      });
      if (!res.ok) { this.flash('Failed to create section', 'error'); return; }
      // Add to document sections
      await this.loadSections();
      var docSections = this.docSections.map(function(s) {
        return { sectionId: s.id, enabled: s.enabled, resumeParagraphText: s.resumeParagraphText || null };
      });
      docSections.push({ sectionId: id, enabled: true });
      await fetch(API_BASE + '/api/documents/cv', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sections: docSections }),
      });
      await this.loadDocumentSections('cv');
      this.flash('Section created', 'success');
    },

    async deleteSection(sectionId) {
      if (!this.requireBackend()) return;
      if (!confirm('Delete this section and all its entries?')) return;
      var res = await fetch(API_BASE + '/api/sections/' + sectionId, { method: 'DELETE' });
      if (!res.ok) { this.flash('Failed to delete', 'error'); return; }
      await this.loadSections();
      await this.loadDocumentSections('cv');
      this.flash('Section deleted', 'success');
    },

    async saveSectionTitle(sectionId, newTitle) {
      var trimmed = newTitle.trim();
      if (!trimmed) return;
      if (!this.requireBackend()) return;
      var sec = this.docSections.find(function(s) { return s.id === sectionId; });
      if (sec && sec.title === trimmed) return;
      await fetch(API_BASE + '/api/sections/' + sectionId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      });
      if (sec) sec.title = trimmed;
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
          this.saveDocumentSections();
          this.flash('Section order saved', 'success');
        }
      });
    },

    async saveDocumentSections() {
      if (!this.serverConnected) return;
      const sections = this.docSections.map(s => ({
        sectionId: s.id,
        enabled: s.enabled,
        resumeParagraphText: s.resumeParagraphText || null,
      }));
      // Save for the current pdfTab variant (or cv by default)
      const variant = this.pdfTab === 'coverletter' ? 'cv' : this.pdfTab;
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
      if (!this.requireBackend()) return;
      this.compiling = true;
      const name = this.pdfTab;
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
    },
  };
}
