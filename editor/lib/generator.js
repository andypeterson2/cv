/**
 * Generates .tex files from database data for compilation.
 *
 * Orchestrates the existing serializer to produce .tex from the
 * nested objects returned by db.getAllForCompile().
 */

const path = require('path');
const fs = require('fs');
const {
  serializeSection,
  serializeData,
} = require('./serializer');

// ---------------------------------------------------------------------------
// data.tex generation
// ---------------------------------------------------------------------------

/**
 * Generate data.tex from personal info + metrics.
 * Reuses the existing serializeData() which expects { personal, metrics }.
 */
function generateDataTex(personal, metrics) {
  // Map DB format to serializer's expected format.
  // Pass all personal fields through — the serializer decides which to emit.
  const p = Object.assign({}, personal);
  // Transform photo fields into the nested object the serializer expects
  p.photo = p.photoEnabled === '1'
    ? { enabled: true, file: p.photoFile || 'profile' }
    : null;
  delete p.photoEnabled;
  delete p.photoFile;

  const data = {
    personal: p,
    metrics: metrics.map(m => ({
      command: m.command,
      label: m.label,
      value: m.value,
      group: m.groupName,
    })),
  };
  return serializeData(data);
}

// ---------------------------------------------------------------------------
// Section .tex generation
// ---------------------------------------------------------------------------

/**
 * Generate a section .tex file from a section object.
 * Maps DB entry format (with JSON fields) to what serializeSection expects.
 */
function generateSectionTex(section) {
  const data = { type: section.type, title: section.title };

  if (section.type === 'cvparagraph') {
    // cvparagraph expects { type, title, text }
    const entry = section.entries[0];
    data.text = entry ? (entry.fields.text || '') : '';
  } else {
    // All other types expect { type, title, entries: [...] }
    data.entries = section.entries.map(e => {
      const entry = { ...e.fields };
      // cventries have items (bullet points)
      if (section.type === 'cventries' && e.items) {
        entry.items = e.items.map(i => i.content);
      }
      return entry;
    });
  }

  return serializeSection(data);
}

// ---------------------------------------------------------------------------
// Document .tex generation (cv.tex, resume.tex)
// ---------------------------------------------------------------------------

const DOC_PREAMBLE = `%!TEX TS-program = xelatex
%!TEX encoding = UTF-8 Unicode

\\documentclass[11pt, letterpaper]{awesome-cv}

\\geometry{left=1.4cm, top=.8cm, right=1.4cm, bottom=1.8cm, footskip=.5cm}

\\colorlet{awesome}{spinel}

\\setbool{acvSectionColorHighlight}{true}

\\renewcommand{\\acvHeaderSocialSep}{\\quad\\textbar\\quad}

\\input{data.tex}


\\begin{document}

\\makecvheader

\\makecvfooter
  {}
  {}
  {}

`;

const DOC_POSTAMBLE = `

\\end{document}`;

function generateDocumentTex(variant, sectionFiles) {
  const lines = [DOC_PREAMBLE];
  for (const file of sectionFiles) {
    lines.push(`\\input{${file}}`);
  }
  lines.push(DOC_POSTAMBLE);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Cover letter .tex generation
// ---------------------------------------------------------------------------

function generateCoverletterTex(personal, coverletter) {
  const lines = [];
  lines.push('%!TEX TS-program = xelatex');
  lines.push('%!TEX encoding = UTF-8 Unicode');
  lines.push('');
  lines.push('\\documentclass[11pt, letterpaper]{awesome-cv}');
  lines.push('');
  lines.push('\\geometry{left=1.4cm, top=.8cm, right=1.4cm, bottom=1.8cm, footskip=.5cm}');
  lines.push('');
  lines.push('\\colorlet{awesome}{spinel}');
  lines.push('');
  lines.push('\\setbool{acvSectionColorHighlight}{true}');
  lines.push('');
  lines.push('\\renewcommand{\\acvHeaderSocialSep}{\\quad\\textbar\\quad}');
  lines.push('');
  lines.push('\\input{data.tex}');
  lines.push('');
  lines.push('');
  lines.push('\\recipient');
  lines.push(`  {${coverletter.recipientName || ''}}`);
  lines.push(`  {${coverletter.recipientAddress || ''}}`);
  lines.push('\\letterdate{\\today}');
  lines.push(`\\lettertitle{${coverletter.title || ''}}`);
  lines.push(`\\letteropening{${coverletter.opening || ''}}`);
  lines.push(`\\letterclosing{${coverletter.closing || ''}}`);
  lines.push(`\\letterenclosure[${coverletter.enclosureLabel || 'Attached'}]{${coverletter.enclosureContent || ''}}`);
  lines.push('');
  lines.push('');
  lines.push('\\begin{document}');
  lines.push('');
  lines.push('\\makecvheader[R]');
  lines.push('');
  lines.push('\\makecvfooter');
  lines.push('  {\\today}');
  lines.push(`  {${personal.firstName || ''} ${personal.lastName || ''}~~~\\cdotp~~~Cover Letter}`);
  lines.push('  {}');
  lines.push('');
  lines.push('\\makelettertitle');
  lines.push('');
  lines.push('\\begin{cvletter}');
  lines.push('');

  if (coverletter.sections) {
    for (const sec of coverletter.sections) {
      lines.push(`\\lettersection{${sec.title}}`);
      lines.push(sec.body);
      lines.push('');
    }
  }

  lines.push('\\end{cvletter}');
  lines.push('');
  lines.push('');
  lines.push('\\makeletterclosing');
  lines.push('');
  lines.push('\\end{document}');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Full build: write all .tex files to a build directory
// ---------------------------------------------------------------------------

/**
 * Generate all .tex files for a document variant and write to buildDir.
 *
 * @param {object} compileData - Output of db.getAllForCompile(variant)
 * @param {string} buildDir - Directory to write files into
 * @param {string} templatesDir - Directory containing awesome-cv.cls
 * @param {string} assetsDir - Directory containing assets (profile photos, etc.)
 * @returns {string} Path to the main .tex file for compilation
 */
function generateAll(compileData, buildDir, templatesDir, assetsDir) {
  const { personal, metrics, sections, coverletter, variant } = compileData;

  // Ensure build directory exists
  fs.mkdirSync(buildDir, { recursive: true });

  // Copy all template files (awesome-cv.cls, fontawesome6.sty, .otf fonts, accsupp.sty, etc.)
  if (fs.existsSync(templatesDir)) {
    for (const file of fs.readdirSync(templatesDir)) {
      fs.copyFileSync(path.join(templatesDir, file), path.join(buildDir, file));
    }
  }

  // Copy assets directory
  if (assetsDir && fs.existsSync(assetsDir)) {
    const assetsDest = path.join(buildDir, 'assets');
    fs.mkdirSync(assetsDest, { recursive: true });
    for (const file of fs.readdirSync(assetsDir)) {
      fs.copyFileSync(path.join(assetsDir, file), path.join(assetsDest, file));
    }
  }

  // Generate data.tex
  const dataTex = generateDataTex(personal, metrics);
  fs.writeFileSync(path.join(buildDir, 'data.tex'), dataTex + '\n', 'utf-8');

  if (variant === 'coverletter') {
    // Generate coverletter.tex
    const clTex = generateCoverletterTex(personal, coverletter);
    fs.writeFileSync(path.join(buildDir, 'coverletter.tex'), clTex + '\n', 'utf-8');
    return path.join(buildDir, 'coverletter.tex');
  }

  // Generate section .tex files
  const sectionFiles = [];
  for (const section of sections) {
    const filename = `${section.id}.tex`;
    const tex = generateSectionTex(section);
    fs.writeFileSync(path.join(buildDir, filename), tex + '\n', 'utf-8');
    sectionFiles.push(filename);
  }

  // Generate main document .tex
  const mainFilename = `${variant}.tex`;
  const docTex = generateDocumentTex(variant, sectionFiles);
  fs.writeFileSync(path.join(buildDir, mainFilename), docTex + '\n', 'utf-8');

  return path.join(buildDir, mainFilename);
}

module.exports = {
  generateDataTex,
  generateSectionTex,
  generateDocumentTex,
  generateCoverletterTex,
  generateAll,
};
