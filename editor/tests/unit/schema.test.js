const { validators, validate, isValidKind } = require('../../lib/schema');

describe('settings schema', () => {
  const v = validators.settings;
  it('accepts string + {num,unit} values', () => {
    expect(
      v({ 'style.accentColor': 'emerald', 'spacing.marginTop': { num: 1.5, unit: 'cm' } }),
    ).toBe(true);
  });
  it('rejects empty object', () => expect(v({})).toBe(false));
});

describe('createPerson / personal', () => {
  it('createPerson requires a name', () => {
    expect(validators.createPerson({ name: 'Ada' })).toBe(true);
    expect(validators.createPerson({})).toBe(false);
  });
  it('personal requires ≥1 string field', () => {
    expect(validators.personal({ firstName: 'Ada' })).toBe(true);
    expect(validators.personal({})).toBe(false);
    expect(validators.personal({ firstName: 123 })).toBe(false);
  });
});

describe('createSection schema', () => {
  const v = validators.createSection;
  it('accepts slug + valid type + title', () => {
    expect(v({ slug: 'experience', type: 'experience', title: 'Experience' })).toBe(true);
  });
  it('rejects invalid type', () =>
    expect(v({ slug: 'x', type: 'invalid', title: 'X' })).toBe(false));
  it('rejects slug with spaces', () =>
    expect(v({ slug: 'has space', type: 'experience', title: 'X' })).toBe(false));
  it('rejects missing slug', () => expect(v({ type: 'experience', title: 'X' })).toBe(false));
});

describe('updateSection schema', () => {
  const v = validators.updateSection;
  it('accepts a partial update', () => expect(v({ title: 'New' })).toBe(true));
  it('rejects empty object', () => expect(v({})).toBe(false));
});

describe('entry / item schemas', () => {
  it('createEntry needs fields, updateEntry too', () => {
    expect(validators.createEntry({ fields: { position: 'Dev' } })).toBe(true);
    expect(validators.createEntry({})).toBe(false);
    expect(validators.updateEntry({ fields: {} })).toBe(true);
    expect(validators.updateEntry({})).toBe(false);
  });
  it('createItem needs content; updateItem needs ≥1 prop', () => {
    expect(validators.createItem({ content: 'x' })).toBe(true);
    expect(validators.createItem({})).toBe(false);
    expect(validators.updateItem({ title: 't' })).toBe(true);
    expect(validators.updateItem({})).toBe(false);
  });
});

describe('reorder schema', () => {
  const v = validators.reorder;
  it('accepts unique positive ints', () => expect(v({ ids: [3, 1, 2] })).toBe(true));
  it('rejects empty / duplicate / zero / non-int', () => {
    expect(v({ ids: [] })).toBe(false);
    expect(v({ ids: [1, 1] })).toBe(false);
    expect(v({ ids: [0] })).toBe(false);
    expect(v({ ids: [1.5] })).toBe(false);
  });
});

describe('addTags schema', () => {
  const v = validators.addTags;
  it('accepts a non-empty list of strings', () => expect(v({ tags: ['frontend'] })).toBe(true));
  it('rejects empty list / missing', () => {
    expect(v({ tags: [] })).toBe(false);
    expect(v({})).toBe(false);
  });
});

describe('setCatalogTag schema', () => {
  const v = validators.setCatalogTag;
  it('requires tag; description/category optional', () => {
    expect(v({ tag: 'frontend' })).toBe(true);
    expect(v({ tag: 'frontend', description: 'UI work', category: 'skill' })).toBe(true);
    expect(v({})).toBe(false);
    expect(v({ tag: 123 })).toBe(false); // wrong type rejected (extra props are stripped, not rejected)
  });
});

describe('suggestTags schema', () => {
  const v = validators.suggestTags;
  it('requires text; bounds limit/minScore; scorer enum', () => {
    expect(v({ text: 'built a react app' })).toBe(true);
    expect(v({ text: 'x', limit: 5, minScore: 0.4, scorer: 'embedding' })).toBe(true);
    expect(v({})).toBe(false);
    expect(v({ text: 'x', minScore: 2 })).toBe(false);
    expect(v({ text: 'x', scorer: 'magic' })).toBe(false);
  });
});

describe('variant schemas', () => {
  it('createVariant requires name + valid kind', () => {
    expect(validators.createVariant({ name: 'FE', kind: 'resume' })).toBe(true);
    expect(validators.createVariant({ name: 'FE', kind: 'bad' })).toBe(false);
    expect(validators.createVariant({ kind: 'cv' })).toBe(false);
  });
  it('variantRules accepts include/exclude tag lists', () => {
    expect(validators.variantRules({ include: ['a'], exclude: ['b'] })).toBe(true);
    expect(validators.variantRules({})).toBe(true);
  });
  it('variantSections requires sectionId per row', () => {
    expect(validators.variantSections({ sections: [{ sectionId: 1, enabled: true }] })).toBe(true);
    expect(validators.variantSections({ sections: [{ enabled: true }] })).toBe(false);
  });
  it('variantOverride requires targetType + targetId; included may be null', () => {
    expect(validators.variantOverride({ targetType: 'entry', targetId: 5, included: null })).toBe(
      true,
    );
    expect(validators.variantOverride({ targetType: 'item', targetId: 5, textOverride: 'x' })).toBe(
      true,
    );
    expect(validators.variantOverride({ targetType: 'bogus', targetId: 5 })).toBe(false);
    expect(validators.variantOverride({ targetType: 'entry' })).toBe(false);
  });
  it('letter section schemas', () => {
    expect(validators.createLetterSection({ title: 'Intro', body: 'Hi' })).toBe(true);
    expect(validators.createLetterSection({ title: 'Intro' })).toBe(false);
    expect(validators.updateLetterSection({ body: 'Hi' })).toBe(true);
    expect(validators.updateLetterSection({})).toBe(false);
  });
  it('letter header schema', () => {
    expect(validators.letterHeader({ recipientName: 'Acme' })).toBe(true);
    expect(validators.letterHeader({ recipientName: 'Acme', opening: 'Dear,' })).toBe(true);
    expect(validators.letterHeader({})).toBe(false); // must set at least one field
    expect(validators.letterHeader({ recipientName: 5 })).toBe(false); // must be strings
    // unknown keys are stripped (ajv removeAdditional), not rejected — so the
    // known field survives and the unknown one is dropped
    const body = { recipientName: 'Acme', bogus: 'x' };
    expect(validators.letterHeader(body)).toBe(true);
    expect(body).toEqual({ recipientName: 'Acme' });
  });
});

describe('isValidKind', () => {
  it('accepts cv/resume/coverletter, rejects others', () => {
    for (const k of ['cv', 'resume', 'coverletter']) expect(isValidKind(k)).toBe(true);
    expect(isValidKind('other')).toBe(false);
    expect(isValidKind('')).toBe(false);
  });
});

describe('validate middleware', () => {
  it('calls next on valid body', () => {
    const req = { body: { name: 'Ada' } };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    validate('createPerson')(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
  it('returns 400 on invalid body', () => {
    const req = { body: {} };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    validate('createPerson')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Validation failed' }));
  });
  it('throws on unknown schema name', () => {
    expect(() => validate('nonexistent')).toThrow('Unknown schema: nonexistent');
  });
});
