#!/usr/bin/env node
/**
 * One-time migration script: parse existing .tex files + data.json + resume-config.json
 * into the new SQLite database.
 *
 * Usage: node migrate.js [--db <path>] [--dry-run]
 */

const path = require('path');
const fs = require('fs');
const CvDatabase = require('./editor/lib/db');
const { parseSection, parseDocument, parseData, parseCoverletter } = require('./editor/lib/parser');

const PROJECT_ROOT = __dirname;
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const dbIdx = args.indexOf('--db');
const dbPath = dbIdx !== -1 ? args[dbIdx + 1] : path.join(PROJECT_ROOT, 'cv.db');

function readFile(relPath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, relPath), 'utf-8');
}

function fileExists(relPath) {
  return fs.existsSync(path.join(PROJECT_ROOT, relPath));
}

// ---------------------------------------------------------------------------
// Main migration
// ---------------------------------------------------------------------------

function migrate() {
  console.log(`Migrating to: ${dbPath}`);
  if (dryRun) console.log('(dry run — no DB will be written)\n');

  // 1. Parse data.json
  console.log('1. Parsing data.json...');
  const dataJson = JSON.parse(readFile('data.json'));
  const personal = dataJson.personal;
  const metricsJson = dataJson.metrics;
  console.log(`   Personal: ${personal.firstName} ${personal.lastName}`);
  console.log(`   Metrics: ${metricsJson.length} variables`);

  // 2. Parse cv.tex for section ordering
  console.log('\n2. Parsing cv.tex for section list...');
  const cvDoc = parseDocument(readFile('cv.tex'));
  console.log(`   CV sections: ${cvDoc.sections.length}`);
  for (const s of cvDoc.sections) {
    console.log(`     ${s.enabled ? '✓' : '✗'} ${s.file}`);
  }

  // 3. Parse each section .tex file
  console.log('\n3. Parsing section .tex files...');
  const sectionData = {};
  for (const s of cvDoc.sections) {
    if (!fileExists(s.file)) {
      console.log(`   SKIP ${s.file} (file not found)`);
      continue;
    }
    const tex = readFile(s.file);
    const parsed = parseSection(tex);
    const sectionId = path.basename(s.file, '.tex');
    sectionData[sectionId] = { ...parsed, file: s.file, enabled: s.enabled };
    const entryCount = parsed.entries ? parsed.entries.length : (parsed.text ? 1 : 0);
    console.log(`   ${sectionId}: ${parsed.type}, ${entryCount} entries`);
  }

  // 4. Parse resume-config.json
  console.log('\n4. Parsing resume-config.json...');
  let resumeConfig = { sectionOrder: [], sections: {} };
  if (fileExists('resume-config.json')) {
    resumeConfig = JSON.parse(readFile('resume-config.json'));
    console.log(`   Resume sections: ${resumeConfig.sectionOrder.length}`);
  } else {
    console.log('   (not found, using defaults)');
  }

  // 5. Parse coverletter.tex
  console.log('\n5. Parsing coverletter.tex...');
  let coverletterData = null;
  if (fileExists('coverletter.tex')) {
    coverletterData = parseCoverletter(readFile('coverletter.tex'));
    console.log(`   Sections: ${coverletterData.sections.length}`);
  }

  // 6. Parse resume.tex for its section ordering
  console.log('\n6. Parsing resume.tex...');
  let resumeDoc = { sections: [] };
  if (fileExists('resume.tex')) {
    resumeDoc = parseDocument(readFile('resume.tex'));
    console.log(`   Resume sections: ${resumeDoc.sections.length}`);
  }

  if (dryRun) {
    console.log('\n--- Dry run complete. No database created. ---');
    return;
  }

  // ---------------------------------------------------------------------------
  // Write to database
  // ---------------------------------------------------------------------------

  // Remove existing DB if present
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
    console.log(`\nRemoved existing ${dbPath}`);
  }

  const db = new CvDatabase(dbPath);

  try {
    console.log('\n7. Writing personal info to settings...');
    const settingsMap = {};
    if (personal.firstName) settingsMap['personal.firstName'] = personal.firstName;
    if (personal.lastName) settingsMap['personal.lastName'] = personal.lastName;
    if (personal.position) settingsMap['personal.position'] = personal.position;
    if (personal.address) settingsMap['personal.address'] = personal.address;
    if (personal.mobile) settingsMap['personal.mobile'] = personal.mobile;
    if (personal.email) settingsMap['personal.email'] = personal.email;
    if (personal.github) settingsMap['personal.github'] = personal.github;
    if (personal.linkedin) settingsMap['personal.linkedin'] = personal.linkedin;
    if (personal.homepage) settingsMap['personal.homepage'] = personal.homepage;
    if (personal.quote !== undefined) settingsMap['personal.quote'] = personal.quote || '';
    if (personal.photo) {
      settingsMap['personal.photoEnabled'] = personal.photo.enabled ? '1' : '0';
      settingsMap['personal.photoFile'] = personal.photo.file || 'profile';
    }
    db.setSettings(settingsMap);
    console.log(`   Set ${Object.keys(settingsMap).length} settings`);

    console.log('\n8. Creating sections and entries...');
    const entryIdMap = {}; // sectionId -> [entryId, entryId, ...]

    for (const [sectionId, data] of Object.entries(sectionData)) {
      db.createSection(sectionId, data.type, data.title);
      entryIdMap[sectionId] = [];

      if (data.type === 'cvparagraph') {
        const entryId = db.createEntry(sectionId, { text: data.text || '' });
        entryIdMap[sectionId].push(entryId);
        console.log(`   ${sectionId}: 1 paragraph entry`);
      } else if (data.entries) {
        for (const entry of data.entries) {
          let fields;
          switch (data.type) {
            case 'cventries':
              fields = {
                position: entry.position || '',
                organization: entry.organization || '',
                location: entry.location || '',
                date: entry.date || '',
              };
              break;
            case 'cvskills':
              fields = { category: entry.category || '', skills: entry.skills || '' };
              break;
            case 'cvhonors':
              fields = {
                award: entry.award || '',
                issuer: entry.issuer || '',
                location: entry.location || '',
                date: entry.date || '',
              };
              break;
            case 'cvreferences':
              fields = {
                name: entry.name || '',
                relation: entry.relation || '',
                phone: entry.phone || '',
                email: entry.email || '',
              };
              break;
            default:
              fields = entry;
          }

          const entryId = db.createEntry(sectionId, fields);
          entryIdMap[sectionId].push(entryId);

          // Add bullet items for cventries
          if (entry.items && Array.isArray(entry.items)) {
            for (const item of entry.items) {
              db.createItem(entryId, item);
            }
          }
        }
        console.log(`   ${sectionId}: ${data.entries.length} entries`);
      }
    }

    console.log('\n9. Creating metrics...');
    for (const m of metricsJson) {
      // Map section file path to section id: "cv/experience.tex" -> "experience"
      const sectionFile = m.section || '';
      const sectionId = path.basename(sectionFile, '.tex');

      if (!sectionData[sectionId]) {
        console.log(`   SKIP metric '${m.command}' — section '${sectionId}' not found`);
        continue;
      }

      db.createMetric({
        command: m.command,
        label: m.label || '',
        value: m.value ?? null,
        groupName: m.group || '',
        sectionId: sectionId,
      });
    }
    console.log(`   Created ${metricsJson.length} metrics`);

    console.log('\n10. Setting document section ordering...');

    // CV document
    const cvSections = cvDoc.sections.map(s => ({
      sectionId: path.basename(s.file, '.tex'),
      enabled: s.enabled,
    }));
    db.setDocumentSections('cv', cvSections);
    console.log(`    CV: ${cvSections.length} sections`);

    // Resume document — use resume-config sectionOrder
    const resumeSections = resumeConfig.sectionOrder.map(file => {
      const sectionId = path.basename(file, '.tex');
      const secConfig = resumeConfig.sections[file] || {};
      return {
        sectionId,
        enabled: secConfig.resume !== false,
        resumeParagraphText: secConfig.resumeText || null,
      };
    });
    db.setDocumentSections('resume', resumeSections);
    console.log(`    Resume: ${resumeSections.length} sections`);

    console.log('\n11. Applying resume filters...');
    let filterCount = 0;
    for (const [file, secConfig] of Object.entries(resumeConfig.sections)) {
      const sectionId = path.basename(file, '.tex');
      if (!entryIdMap[sectionId]) continue;

      if (secConfig.entries) {
        for (let i = 0; i < secConfig.entries.length; i++) {
          const entryConfig = secConfig.entries[i];
          const entryId = entryIdMap[sectionId][i];
          if (!entryId) continue;

          // Set entry resume inclusion
          if (entryConfig.resume === false) {
            db.updateEntry(entryId, { resumeIncluded: false });
            filterCount++;
          }

          // Set item resume inclusion
          if (entryConfig.items && Array.isArray(entryConfig.items)) {
            const section = db.getSection(sectionId);
            const entry = section.entries.find(e => e.id === entryId);
            if (entry) {
              for (let j = 0; j < entryConfig.items.length; j++) {
                if (entryConfig.items[j] === false && entry.items[j]) {
                  db.updateItem(entry.items[j].id, { resumeIncluded: false });
                  filterCount++;
                }
              }
            }
          }
        }
      }
    }
    console.log(`    Applied ${filterCount} resume exclusions`);

    console.log('\n12. Writing cover letter...');
    if (coverletterData) {
      const clSettings = {};
      clSettings['coverletter.recipientName'] = coverletterData.recipient.name || '';
      clSettings['coverletter.recipientAddress'] = coverletterData.recipient.address || '';
      clSettings['coverletter.title'] = coverletterData.title || '';
      clSettings['coverletter.opening'] = coverletterData.opening || '';
      clSettings['coverletter.closing'] = coverletterData.closing || '';
      clSettings['coverletter.enclosureLabel'] = coverletterData.enclosure.label || 'Attached';
      clSettings['coverletter.enclosureContent'] = coverletterData.enclosure.content || '';
      db.setSettings(clSettings);

      for (const sec of coverletterData.sections) {
        db.createCoverletterSection(sec.title, sec.body);
      }
      console.log(`    Wrote ${coverletterData.sections.length} letter sections`);
    }

    // ---------------------------------------------------------------------------
    // Verify
    // ---------------------------------------------------------------------------

    console.log('\n--- Verification ---');
    const exportData = db.getAllForExport();
    console.log(`Personal: ${exportData.personal.firstName} ${exportData.personal.lastName}`);
    console.log(`Sections: ${exportData.sections.length}`);
    for (const s of exportData.sections) {
      const entryCount = s.entries ? s.entries.length : 0;
      const itemCount = s.entries ? s.entries.reduce((sum, e) => sum + (e.items ? e.items.length : 0), 0) : 0;
      console.log(`  ${s.id} (${s.type}): ${entryCount} entries, ${itemCount} items`);
    }
    console.log(`Metrics: ${exportData.metrics.length}`);
    console.log(`CV sections: ${exportData.documents.cv.length}`);
    console.log(`Resume sections: ${exportData.documents.resume.length}`);
    console.log(`Cover letter sections: ${exportData.coverletter.sections.length}`);

    console.log(`\nMigration complete! Database written to: ${dbPath}`);
  } finally {
    db.close();
  }
}

migrate();
