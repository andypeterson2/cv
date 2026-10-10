const { checkText, sourceStrings, plain } = require('../../lib/render/text-check');
const { buildContext } = require('../../lib/render/context');

const ctx = buildContext({
  variant: 'cv',
  personal: {
    firstName: 'Jane',
    lastName: 'Doe',
    position: 'Senior Engineer',
    mobile: '(555) 123-4567',
    email: 'jane@example.com',
    github: 'janedoe',
  },
  sections: [
    {
      id: 'experience',
      type: 'experience',
      title: 'Experience',
      entries: [
        {
          fields: { position: 'Senior Engineer', organization: 'Acme', date: '2022 -- Present' },
          items: [{ content: 'Rescheduled last-mile jobs at 60\\% cost \\rightarrow 2× faster' }],
        },
      ],
    },
  ],
});

const CLEAN = [
  'Jane Doe',
  'Senior Engineer',
  '(555) 123-4567 | jane@example.com | janedoe',
  'Experience',
  'Acme',
  'Senior Engineer 2022 – Present',
  '• Rescheduled last-mile jobs at 60% cost → 2× faster',
].join('\n');

const rules = (text, opts) => checkText(ctx, text, opts).issues.map((i) => i.rule);

describe('plain', () => {
  it('unescapes LaTeX and maps palette commands to glyphs', () => {
    // TeX swallows the space after a control word, so the source reads "→done".
    expect(plain('60\\% \\rightarrow done -- now')).toBe('60% →done – now');
    expect(plain('a \\to{} b')).toBe('a → b');
  });
});

describe('sourceStrings', () => {
  it('keeps body text apart from optional header fields', () => {
    const { body, extra } = sourceStrings(ctx);
    expect(body).toContain('Experience');
    expect(extra).toContain('jane@example.com');
    expect(body).not.toContain('jane@example.com');
  });
});

describe('checkText', () => {
  it('passes a faithful extraction', () => {
    expect(checkText(ctx, CLEAN)).toEqual({ ok: true, issues: [] });
  });

  it('flags non-breaking hyphens', () => {
    const r = checkText(ctx, CLEAN.replace('last-mile', 'last‑mile'));
    expect(r.ok).toBe(false);
    expect(r.issues).toContainEqual({ rule: 'foreign-char', sample: 'U+2011 ‑' });
  });

  it('flags words split at a line end', () => {
    expect(rules(CLEAN.replace('Rescheduled', 'Resched-\nuled'))).toContain('line-split');
  });

  it('flags mixed-case small caps', () => {
    expect(rules(CLEAN.replace('Senior Engineer 2022', 'SENiOR ENGiNEER 2022'))).toContain(
      'mixed-case',
    );
  });

  it('flags dotless i from a small-cap glyph', () => {
    expect(rules(CLEAN + '\nSENıOR')).toContain('foreign-char');
  });

  it('flags header labels', () => {
    expect(rules(CLEAN.replace('jane@example.com', 'mailto:jane@example.com'))).toContain(
      'foreign-word',
    );
  });

  it('accepts a social as its profile link', () => {
    expect(sourceStrings(ctx).extra).toContain('github.com/janedoe');
    expect(checkText(ctx, CLEAN.replace('| janedoe', '| github.com/janedoe')).ok).toBe(true);
  });

  it('flags missing words', () => {
    expect(checkText(ctx, CLEAN.replace('Acme', '')).issues).toContainEqual({
      rule: 'missing-word',
      sample: 'Acme',
    });
  });

  it('flags a symbol that extracts as something else', () => {
    expect(checkText(ctx, CLEAN.replace('→', '�')).ok).toBe(false);
  });

  it('accepts words layouts add on their own', () => {
    expect(checkText(ctx, `${CLEAN}\nOctober 10, 2026\nCover Letter`).ok).toBe(true);
  });
});
