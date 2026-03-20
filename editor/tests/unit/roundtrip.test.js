/**
 * Round-trip tests: parse → serialize → parse should produce stable output.
 * This ensures the parser and serializer are consistent with each other.
 */
const { parseSection, parseData, parseCoverletter } = require('../../lib/parser');
const { serializeSection, serializeData, serializeCoverletter } = require('../../lib/serializer');
const fs = require('fs');
const path = require('path');

const FIXTURES = path.resolve(__dirname, '..', '..', '..');

function readFixture(relPath) {
  return fs.readFileSync(path.join(FIXTURES, relPath), 'utf-8');
}

describe('round-trip: cventries (experience)', () => {
  test('parse → serialize → parse produces same data', () => {
    const tex = readFixture('cv/experience.tex');
    const parsed1 = parseSection(tex);
    const serialized = serializeSection(parsed1);
    const parsed2 = parseSection(serialized);

    expect(parsed2.type).toBe(parsed1.type);
    expect(parsed2.title).toBe(parsed1.title);
    expect(parsed2.entries.length).toBe(parsed1.entries.length);

    for (let i = 0; i < parsed1.entries.length; i++) {
      expect(parsed2.entries[i].position).toBe(parsed1.entries[i].position);
      expect(parsed2.entries[i].organization).toBe(parsed1.entries[i].organization);
      expect(parsed2.entries[i].location).toBe(parsed1.entries[i].location);
      expect(parsed2.entries[i].date).toBe(parsed1.entries[i].date);
      expect(parsed2.entries[i].items.length).toBe(parsed1.entries[i].items.length);
      for (let j = 0; j < parsed1.entries[i].items.length; j++) {
        expect(parsed2.entries[i].items[j]).toBe(parsed1.entries[i].items[j]);
      }
    }
  });
});

describe('round-trip: cvskills', () => {
  test('parse → serialize → parse produces same data', () => {
    const tex = readFixture('cv/skills.tex');
    const parsed1 = parseSection(tex);
    const serialized = serializeSection(parsed1);
    const parsed2 = parseSection(serialized);

    expect(parsed2.type).toBe(parsed1.type);
    expect(parsed2.title).toBe(parsed1.title);
    expect(parsed2.entries.length).toBe(parsed1.entries.length);

    for (let i = 0; i < parsed1.entries.length; i++) {
      expect(parsed2.entries[i].category).toBe(parsed1.entries[i].category);
      expect(parsed2.entries[i].skills).toBe(parsed1.entries[i].skills);
    }
  });
});

describe('round-trip: cvhonors (certifications)', () => {
  test('parse → serialize → parse produces same data', () => {
    const tex = readFixture('cv/certifications.tex');
    const parsed1 = parseSection(tex);
    const serialized = serializeSection(parsed1);
    const parsed2 = parseSection(serialized);

    expect(parsed2.type).toBe(parsed1.type);
    expect(parsed2.title).toBe(parsed1.title);
    expect(parsed2.entries.length).toBe(parsed1.entries.length);

    for (let i = 0; i < parsed1.entries.length; i++) {
      expect(parsed2.entries[i].award).toBe(parsed1.entries[i].award);
      expect(parsed2.entries[i].issuer).toBe(parsed1.entries[i].issuer);
      expect(parsed2.entries[i].date).toBe(parsed1.entries[i].date);
    }
  });
});

describe('round-trip: cvparagraph (summary)', () => {
  test('parse → serialize → parse produces same data', () => {
    const tex = readFixture('cv/summary.tex');
    const parsed1 = parseSection(tex);
    const serialized = serializeSection(parsed1);
    const parsed2 = parseSection(serialized);

    expect(parsed2.type).toBe(parsed1.type);
    expect(parsed2.title).toBe(parsed1.title);
    expect(parsed2.text).toBe(parsed1.text);
  });
});

describe('round-trip: data.json → data.tex → parseData', () => {
  test('serialize from JSON then parse gives consistent metrics', () => {
    const dataJson = JSON.parse(readFixture('data.json'));
    const tex = serializeData(dataJson);
    const parsedBack = parseData(tex);

    expect(parsedBack.personal.firstName).toBe(dataJson.personal.firstName);
    expect(parsedBack.personal.lastName).toBe(dataJson.personal.lastName);
    expect(parsedBack.personal.email).toBe(dataJson.personal.email);

    // Verify all metrics with values round-trip correctly
    for (const m of dataJson.metrics) {
      if (m.value !== null) {
        const found = parsedBack.metrics.find(pm => pm.command === m.command);
        expect(found).toBeDefined();
        expect(found.value).toBe(m.value);
      }
    }

    // Verify null-value metrics become tbd placeholders that parse back with null value
    for (const m of dataJson.metrics) {
      if (m.value === null) {
        const found = parsedBack.metrics.find(pm => pm.command === m.command);
        expect(found).toBeDefined();
        expect(found.value).toBeNull();
      }
    }
  });
});
