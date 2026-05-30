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
  sanitizeLatex: san,
} = require('./serializer');
const { getLatexType, SECTION_TYPE_MAP } = require('./latex-type-map');

// ---------------------------------------------------------------------------
// data.tex generation
// ---------------------------------------------------------------------------

/**
 * Generate data.tex from personal info.
 * Reuses the existing serializeData() which expects { personal }.
 */
function generateDataTex(personal) {
  // Map DB format to serializer's expected format.
  // Pass all personal fields through — the serializer decides which to emit.
  const p = Object.assign({}, personal);
  // Transform photo fields into the nested object the serializer expects
  p.photo = p.photoEnabled === '1'
    ? { enabled: true, file: p.photoFile || 'profile' }
    : null;
  delete p.photoEnabled;
  delete p.photoFile;

  return serializeData({ personal: p });
}

// ---------------------------------------------------------------------------
// Section .tex generation
// ---------------------------------------------------------------------------

/**
 * Generate a section .tex file from a section object.
 * Maps DB entry format (with JSON fields) to what serializeSection expects.
 */
function generateSectionTex(section) {
  const latexType = getLatexType(section.type);
  const data = { type: section.type, title: section.title };

  if (latexType === 'cvparagraph') {
    // cvparagraph expects { type, title, text }
    const entry = section.entries[0];
    data.text = entry ? (entry.fields.text || '') : '';
  } else {
    // All other types expect { type, title, entries: [...] }
    data.entries = section.entries.map(e => {
      const entry = { ...e.fields };
      // Apply combine rules (e.g. education: program + major → position)
      const typeInfo = SECTION_TYPE_MAP[section.type];
      if (typeInfo && typeInfo.combine) {
        const { target, from, join } = typeInfo.combine;
        entry[target] = from.map(k => entry[k] || '').join(join).trim();
      }
      // cventries have items (bullet points)
      if (latexType === 'cventries' && e.items) {
        entry.items = e.items.map(i => i.content);
      }
      return entry;
    });
  }

  return serializeSection(data);
}

// ---------------------------------------------------------------------------
// Style defaults & preamble builder
// ---------------------------------------------------------------------------

const { STYLE_DEFAULTS, SPACING_DEFAULTS, FONT_DEFAULTS } = require('./style-defaults');
const ACCENT_COLORS = require('./accent-colors');
const PRESET_COLOR_KEYS = ACCENT_COLORS.map(c => c.key);


function buildPreamble(style, spacing, fonts) {
  const s = Object.assign({}, STYLE_DEFAULTS, style);
  const sp = Object.assign({}, SPACING_DEFAULTS, spacing);
  const f = Object.assign({}, FONT_DEFAULTS, fonts);
  const lines = [];
  lines.push('%!TEX TS-program = xelatex');
  lines.push('%!TEX encoding = UTF-8 Unicode');
  lines.push('');
  lines.push(`\\documentclass[${s.fontSize}, ${s.pageSize}]{awesome-cv}`);
  lines.push('');

  // Page geometry — horizontalMargin applies to both left and right
  lines.push(`\\geometry{left=${sp.horizontalMargin}, top=${sp.marginTop}, right=${sp.horizontalMargin}, bottom=${sp.marginBottom}, footskip=${sp.footskip}}`);
  lines.push('');

  // Accent color
  if (PRESET_COLOR_KEYS.includes(s.accentColor)) {
    lines.push(`\\colorlet{awesome}{${s.accentColor}}`);
  } else if (s.accentColor === 'custom' && s.customHex) {
    const hex = s.customHex.replace(/^#/, '');
    lines.push(`\\definecolor{awesome}{HTML}{${hex}}`);
  } else {
    // Legacy: accentColor is a raw hex
    const hex = (s.accentColor || '').replace(/^#/, '');
    if (hex) lines.push(`\\definecolor{awesome}{HTML}{${hex}}`);
  }
  lines.push('');

  lines.push('\\setbool{acvSectionColorHighlight}{true}');
  lines.push('');
  lines.push('\\renewcommand{\\acvHeaderSocialSep}{\\quad\\textbar\\quad}');
  lines.push('');

  // Font override
  if (s.fontFamily === 'roboto') {
    lines.push('\\setmainfont{Roboto}[');
    lines.push('  UprightFont=*,');
    lines.push('  ItalicFont=*-Italic,');
    lines.push('  BoldFont=*-Bold,');
    lines.push('  BoldItalicFont=*-BoldItalic,');
    lines.push('  FontFace={l}{n}{Font=*-Light},');
    lines.push('  FontFace={l}{it}{Font=*-LightItalic},');
    lines.push(']');
    lines.push('\\setsansfont{Roboto}[');
    lines.push('  UprightFont=*,');
    lines.push('  ItalicFont=*-Italic,');
    lines.push('  BoldFont=*-Bold,');
    lines.push('  BoldItalicFont=*-BoldItalic,');
    lines.push('  FontFace={l}{n}{Font=*-Light},');
    lines.push('  FontFace={l}{it}{Font=*-LightItalic},');
    lines.push(']');
    lines.push('');
  }

  // Header spacing overrides — headerLineGap applies to name and position rows
  lines.push(`\\renewcommand{\\acvHeaderAfterNameSkip}{${sp.headerLineGap}}`);
  lines.push(`\\renewcommand{\\acvHeaderAfterPositionSkip}{${sp.headerLineGap}}`);
  lines.push(`\\renewcommand{\\acvHeaderAfterAddressSkip}{${sp.headerAfterAddressSkip}}`);
  lines.push(`\\renewcommand{\\acvHeaderAfterSocialSkip}{${sp.headerAfterSocialSkip}}`);
  lines.push(`\\renewcommand{\\acvHeaderAfterQuoteSkip}{${sp.headerAfterQuoteSkip}}`);
  lines.push('');

  // Section spacing overrides
  lines.push(`\\renewcommand{\\acvSectionTopSkip}{${sp.sectionTopSkip}}`);
  lines.push(`\\renewcommand{\\acvSectionContentTopSkip}{${sp.sectionContentTopSkip}}`);
  lines.push('');

  // Font size overrides
  // headerNameSize: first and last name in header
  lines.push(`\\renewcommand*{\\headerfirstnamestyle}[1]{{\\fontsize{${f.headerNameSize}}{1em}\\headerfontlight\\color{graytext} #1}}`);
  lines.push(`\\renewcommand*{\\headerlastnamestyle}[1]{{\\fontsize{${f.headerNameSize}}{1em}\\headerfont\\bfseries\\color{text} #1}}`);
  // headerPositionSize: position/title line
  lines.push(`\\renewcommand*{\\headerpositionstyle}[1]{{\\fontsize{${f.headerPositionSize}}{1em}\\bodyfont\\scshape\\color{awesome} #1}}`);
  // headerSocialSize: social links
  lines.push(`\\renewcommand*{\\headersocialstyle}[1]{{\\fontsize{${f.headerSocialSize}}{1em}\\headerfont\\color{text} #1}}`);
  // secondaryTextSize: address, footer, entry position/date
  lines.push(`\\renewcommand*{\\headeraddressstyle}[1]{{\\fontsize{${f.secondaryTextSize}}{1em}\\headerfont\\itshape\\color{lighttext} #1}}`);
  lines.push(`\\renewcommand*{\\footerstyle}[1]{{\\fontsize{${f.secondaryTextSize}}{1em}\\footerfont\\scshape\\color{lighttext} #1}}`);
  lines.push(`\\renewcommand*{\\entrypositionstyle}[1]{{\\fontsize{${f.secondaryTextSize}}{1em}\\bodyfont\\scshape\\color{graytext} #1}}`);
  lines.push(`\\renewcommand*{\\entrydatestyle}[1]{{\\fontsize{${f.secondaryTextSize}}{1em}\\bodyfontlight\\slshape\\color{graytext} #1}}`);
  // contentTextSize: body copy, descriptions, honors, skills set, quote, paragraph
  lines.push(`\\renewcommand*{\\headerquotestyle}[1]{{\\fontsize{${f.contentTextSize}}{1em}\\bodyfont\\itshape\\color{darktext} #1}}`);
  lines.push(`\\renewcommand{\\paragraphstyle}{\\fontsize{${f.contentTextSize}}{1em}\\bodyfontlight\\upshape\\color{text}}`);
  lines.push(`\\renewcommand*{\\entrylocationstyle}[1]{{\\fontsize{${f.contentTextSize}}{1em}\\bodyfontlight\\slshape\\color{awesome} #1}}`);
  lines.push(`\\renewcommand*{\\descriptionstyle}[1]{{\\fontsize{${f.contentTextSize}}{1em}\\bodyfontlight\\upshape\\color{text} #1}}`);
  lines.push(`\\renewcommand*{\\honortitlestyle}[1]{{\\fontsize{${f.contentTextSize}}{1em}\\bodyfont\\color{graytext} #1}}`);
  lines.push(`\\renewcommand*{\\honorpositionstyle}[1]{{\\fontsize{${f.contentTextSize}}{1em}\\bodyfont\\bfseries\\color{darktext} #1}}`);
  lines.push(`\\renewcommand*{\\honordatestyle}[1]{{\\fontsize{${f.contentTextSize}}{1em}\\bodyfont\\color{graytext} #1}}`);
  lines.push(`\\renewcommand*{\\honorlocationstyle}[1]{{\\fontsize{${f.contentTextSize}}{1em}\\bodyfontlight\\slshape\\color{awesome} #1}}`);
  lines.push(`\\renewcommand*{\\skillsetstyle}[1]{{\\fontsize{${f.contentTextSize}}{1em}\\bodyfontlight\\color{text} #1}}`);
  // itemTitleSize: entry titles, skill type labels
  lines.push(`\\renewcommand*{\\entrytitlestyle}[1]{{\\fontsize{${f.itemTitleSize}}{1em}\\bodyfont\\bfseries\\color{darktext} #1}}`);
  lines.push(`\\renewcommand*{\\skilltypestyle}[1]{{\\fontsize{${f.itemTitleSize}}{1em}\\bodyfont\\bfseries\\color{darktext} #1}}`);
  // sectionTitleSize and subsectionTitleSize
  lines.push(`\\renewcommand*{\\sectionstyleface}[1]{{\\fontsize{${f.sectionTitleSize}}{1em}\\bodyfont\\bfseries #1}}`);
  lines.push(`\\renewcommand*{\\subsectionstyle}[1]{{\\fontsize{${f.subsectionTitleSize}}{1em}\\bodyfont\\scshape\\textcolor{text}{#1}}}`);
  lines.push('');

  // Entry/items/skills spacing overrides via environment redefinitions
  // contentTopAdjust: used for entry tops and skills section top
  lines.push(`\\renewcommand*{\\cventry}[5]{%`);
  lines.push(`  \\vspace{${sp.contentTopAdjust}}%`);
  lines.push('  \\setlength\\tabcolsep{0pt}%');
  lines.push('  \\setlength{\\extrarowheight}{0pt}%');
  lines.push('  \\begin{tabular*}{\\textwidth}{@{\\extracolsep{\\fill}} L{\\textwidth - 4.5cm} R{4.5cm}}');
  lines.push('    \\ifempty{#2#3}');
  lines.push('      {\\entrypositionstyle{#1} & \\entrydatestyle{#4} \\\\}');
  lines.push('      {\\entrytitlestyle{#2} & \\entrylocationstyle{#3} \\\\');
  lines.push('      \\entrypositionstyle{#1} & \\entrydatestyle{#4} \\\\}');
  lines.push('    \\ifstrempty{#5}');
  lines.push('      {}');
  lines.push('      {\\multicolumn{2}{L{\\textwidth}}{\\descriptionstyle{#5}} \\\\}');
  lines.push('  \\end{tabular*}%');
  lines.push('}');
  lines.push('');

  lines.push('\\renewenvironment{cvitems}{%');
  lines.push(`  \\vspace{${sp.itemsTopSkip}}`);
  lines.push('  \\begin{justify}');
  lines.push(`  \\begin{itemize}[leftmargin=${sp.itemsLeftMargin}, nosep, noitemsep]`);
  lines.push('    \\setlength{\\parskip}{0pt}');
  lines.push('    \\renewcommand{\\labelitemi}{\\bullet}');
  lines.push('}{%');
  lines.push('  \\end{itemize}');
  lines.push('  \\end{justify}');
  lines.push(`  \\vspace{${sp.itemsBottomSkip}}`);
  lines.push('}');
  lines.push('');

  lines.push('\\renewenvironment{cvskills}{%');
  lines.push(`  \\vspace{\\acvSectionContentTopSkip}`);
  lines.push(`  \\vspace{${sp.contentTopAdjust}}`);
  lines.push(`    \\setlength\\tabcolsep{${sp.skillsColSep}}`);
  lines.push('    \\setlength{\\extrarowheight}{0pt}');
  lines.push('    \\tabularx{\\textwidth}{r>{\\raggedright\\let\\newline\\\\\\arraybackslash\\hspace{0pt}}X}');
  lines.push('}{%');
  lines.push('\\endtabularx\\par');
  lines.push('}');
  lines.push('');

  lines.push('\\renewenvironment{cvparagraph}{%');
  lines.push('  \\vspace{\\acvSectionContentTopSkip}');
  lines.push(`  \\vspace{${sp.paragraphTopAdjust}}`);
  lines.push('  \\paragraphstyle');
  lines.push('}{%');
  lines.push('  \\par');
  lines.push(`  \\vspace{${sp.paragraphBottomSkip}}`);
  lines.push('}');
  lines.push('');

  lines.push('\\input{data.tex}');
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Document .tex generation (cv.tex, resume.tex)
// ---------------------------------------------------------------------------

const DOC_POSTAMBLE = `

\\end{document}`;

function generateDocumentTex(variant, sectionFiles, style, spacing, fonts) {
  const lines = [];
  lines.push(buildPreamble(style, spacing, fonts));
  lines.push('');
  lines.push('\\begin{document}');
  lines.push('');
  lines.push('\\makecvheader');
  lines.push('');
  lines.push('\\makecvfooter');
  lines.push('  {}');
  lines.push('  {}');
  lines.push('  {}');
  lines.push('');
  for (const file of sectionFiles) {
    lines.push(`\\input{${file}}`);
  }
  lines.push(DOC_POSTAMBLE);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Cover letter .tex generation
// ---------------------------------------------------------------------------

function generateCoverletterTex(personal, coverletter, style, spacing, fonts) {
  const lines = [];
  lines.push(buildPreamble(style, spacing, fonts));
  lines.push('');
  lines.push('');
  lines.push('\\recipient');
  lines.push(`  {${san(coverletter.recipientName || '')}}`);
  lines.push(`  {${san(coverletter.recipientAddress || '')}}`);
  lines.push('\\letterdate{\\today}');
  lines.push(`\\lettertitle{${san(coverletter.title || '')}}`);
  lines.push(`\\letteropening{${san(coverletter.opening || '')}}`);
  lines.push(`\\letterclosing{${san(coverletter.closing || '')}}`);
  lines.push(`\\letterenclosure[${san(coverletter.enclosureLabel || 'Attached')}]{${san(coverletter.enclosureContent || '')}}`);
  lines.push('');
  lines.push('');
  lines.push('\\begin{document}');
  lines.push('');
  lines.push('\\makecvheader[R]');
  lines.push('');
  lines.push('\\makecvfooter');
  lines.push('  {\\today}');
  lines.push(`  {${san(personal.firstName || '')} ${san(personal.lastName || '')}~~~\\cdotp~~~Cover Letter}`);
  lines.push('  {}');
  lines.push('');
  lines.push('\\makelettertitle');
  lines.push('');
  lines.push('\\begin{cvletter}');
  lines.push('');

  if (coverletter.sections) {
    for (const sec of coverletter.sections) {
      lines.push(`\\lettersection{${san(sec.title || '')}}`);
      lines.push(san(sec.body || ''));
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
  const { personal, sections, coverletter, variant, style, spacing, fonts } = compileData;

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
  const dataTex = generateDataTex(personal);
  fs.writeFileSync(path.join(buildDir, 'data.tex'), dataTex + '\n', 'utf-8');

  if (variant === 'coverletter') {
    // Generate coverletter.tex
    const clTex = generateCoverletterTex(personal, coverletter, style, spacing, fonts);
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
  const docTex = generateDocumentTex(variant, sectionFiles, style, spacing, fonts);
  fs.writeFileSync(path.join(buildDir, mainFilename), docTex + '\n', 'utf-8');

  return path.join(buildDir, mainFilename);
}

module.exports = {
  generateDataTex,
  generateSectionTex,
  generateDocumentTex,
  generateCoverletterTex,
  generateAll,
  STYLE_DEFAULTS,
  SPACING_DEFAULTS,
  FONT_DEFAULTS,
};
