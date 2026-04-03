const { validators, validate, isValidVariant } = require('../../lib/schema');

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

describe('settings schema', () => {
  const v = validators.settings;

  it('accepts valid key-value pairs', () => {
    expect(v({ 'personal.firstName': 'Andrew', 'personal.lastName': 'Peterson' })).toBe(true);
  });

  it('rejects empty object', () => {
    expect(v({})).toBe(false);
  });

  it('rejects non-string values', () => {
    const data = { 'personal.firstName': 123 };
    expect(v(data)).toBe(false);
  });

  it('strips keys with special characters via removeAdditional', () => {
    const data = { 'key with spaces': 'val', 'personal.name': 'ok' };
    // removeAdditional:'all' strips non-matching keys; remaining must have minProperties:1
    v(data);
    expect(data['key with spaces']).toBeUndefined();
    expect(data['personal.name']).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

describe('createSection schema', () => {
  const v = validators.createSection;

  it('accepts valid section', () => {
    expect(v({ id: 'experience', type: 'cventries', title: 'Experience' })).toBe(true);
  });

  it('rejects missing id', () => {
    expect(v({ type: 'cventries', title: 'Experience' })).toBe(false);
  });

  it('rejects invalid type', () => {
    expect(v({ id: 'x', type: 'invalid', title: 'X' })).toBe(false);
  });

  it('rejects id with spaces', () => {
    expect(v({ id: 'has space', type: 'cventries', title: 'X' })).toBe(false);
  });

  it('strips additional properties', () => {
    const data = { id: 'x', type: 'cventries', title: 'X', extra: 'removed' };
    v(data);
    expect(data.extra).toBeUndefined();
  });
});

describe('updateSection schema', () => {
  const v = validators.updateSection;

  it('accepts valid update', () => {
    expect(v({ title: 'New Title' })).toBe(true);
  });

  it('rejects missing title', () => {
    expect(v({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

describe('createEntry schema', () => {
  const v = validators.createEntry;

  it('accepts valid entry', () => {
    expect(v({ fields: { position: 'Dev', organization: 'Co' } })).toBe(true);
  });

  it('rejects missing fields', () => {
    expect(v({})).toBe(false);
  });

  it('accepts empty fields object', () => {
    expect(v({ fields: {} })).toBe(true);
  });

  it('strips additional properties', () => {
    const data = { fields: {}, extra: 'x' };
    v(data);
    expect(data.extra).toBeUndefined();
  });
});

describe('updateEntry schema', () => {
  const v = validators.updateEntry;

  it('accepts fields update', () => {
    expect(v({ fields: { position: 'Senior Dev' } })).toBe(true);
  });

  it('accepts resumeIncluded toggle', () => {
    expect(v({ resumeIncluded: false })).toBe(true);
  });

  it('accepts both fields and resumeIncluded', () => {
    expect(v({ fields: { position: 'Dev' }, resumeIncluded: true })).toBe(true);
  });

  it('rejects empty object', () => {
    expect(v({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

describe('createItem schema', () => {
  const v = validators.createItem;

  it('accepts valid item', () => {
    expect(v({ content: 'Built a feature' })).toBe(true);
  });

  it('accepts empty content', () => {
    expect(v({ content: '' })).toBe(true);
  });

  it('rejects missing content', () => {
    expect(v({})).toBe(false);
  });
});

describe('updateItem schema', () => {
  const v = validators.updateItem;

  it('accepts content update', () => {
    expect(v({ content: 'Updated' })).toBe(true);
  });

  it('accepts resumeIncluded toggle', () => {
    expect(v({ resumeIncluded: true })).toBe(true);
  });

  it('rejects empty object', () => {
    expect(v({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Reorder
// ---------------------------------------------------------------------------

describe('reorder schema', () => {
  const v = validators.reorder;

  it('accepts valid id array', () => {
    expect(v({ ids: [3, 1, 2] })).toBe(true);
  });

  it('rejects empty array', () => {
    expect(v({ ids: [] })).toBe(false);
  });

  it('rejects duplicate ids', () => {
    expect(v({ ids: [1, 1, 2] })).toBe(false);
  });

  it('rejects non-integer ids', () => {
    expect(v({ ids: [1.5, 2] })).toBe(false);
  });

  it('rejects zero ids', () => {
    expect(v({ ids: [0, 1] })).toBe(false);
  });

  it('rejects missing ids', () => {
    expect(v({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Document sections
// ---------------------------------------------------------------------------

describe('documentSections schema', () => {
  const v = validators.documentSections;

  it('accepts valid document sections', () => {
    expect(v({
      sections: [
        { sectionId: 'experience', enabled: true },
        { sectionId: 'skills' },
      ],
    })).toBe(true);
  });

  it('accepts sections with resumeParagraphText', () => {
    expect(v({
      sections: [
        { sectionId: 'summary', resumeParagraphText: 'Short version' },
      ],
    })).toBe(true);
  });

  it('accepts null resumeParagraphText', () => {
    expect(v({
      sections: [{ sectionId: 'summary', resumeParagraphText: null }],
    })).toBe(true);
  });

  it('rejects missing sections', () => {
    expect(v({})).toBe(false);
  });

  it('rejects section without sectionId', () => {
    expect(v({ sections: [{ enabled: true }] })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cover letter sections
// ---------------------------------------------------------------------------

describe('createCoverletterSection schema', () => {
  const v = validators.createCoverletterSection;

  it('accepts valid section', () => {
    expect(v({ title: 'About Me', body: 'I am great.' })).toBe(true);
  });

  it('rejects missing title', () => {
    expect(v({ body: 'text' })).toBe(false);
  });

  it('rejects missing body', () => {
    expect(v({ title: 'About' })).toBe(false);
  });
});

describe('updateCoverletterSection schema', () => {
  const v = validators.updateCoverletterSection;

  it('accepts title only', () => {
    expect(v({ title: 'New Title' })).toBe(true);
  });

  it('accepts body only', () => {
    expect(v({ body: 'New body' })).toBe(true);
  });

  it('rejects empty object', () => {
    expect(v({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isValidVariant
// ---------------------------------------------------------------------------

describe('isValidVariant', () => {
  it('accepts cv', () => expect(isValidVariant('cv')).toBe(true));
  it('accepts resume', () => expect(isValidVariant('resume')).toBe(true));
  it('accepts coverletter', () => expect(isValidVariant('coverletter')).toBe(true));
  it('rejects invalid', () => expect(isValidVariant('other')).toBe(false));
  it('rejects empty', () => expect(isValidVariant('')).toBe(false));
});

// ---------------------------------------------------------------------------
// validate middleware
// ---------------------------------------------------------------------------

describe('validate middleware', () => {
  it('calls next on valid body', () => {
    const middleware = validate('createSection');
    const req = { body: { id: 'test', type: 'cventries', title: 'Test' } };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 400 on invalid body', () => {
    const middleware = validate('createSection');
    const req = { body: {} };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    middleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Validation failed' }));
  });

  it('throws on unknown schema name', () => {
    expect(() => validate('nonexistent')).toThrow('Unknown schema: nonexistent');
  });
});
