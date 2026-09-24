import { describe, expect, it } from 'vitest';
import { currentOriginSecret } from '../src/origin-secret';

// cv accepts a comma-separated set of origin secrets so the value can rotate without
// an outage. A sender presents a single entry; the raw setting matches nothing.
describe('currentOriginSecret', () => {
  it('passes a single value through unchanged', () => {
    expect(currentOriginSecret('only-one')).toBe('only-one');
  });

  it('presents the first entry mid-rotation, never the whole list', () => {
    expect(currentOriginSecret('new-value,old-value')).toBe('new-value');
    expect(currentOriginSecret(' new-value , old-value ')).toBe('new-value');
  });

  it('is undefined when nothing is configured, so callers can omit the header', () => {
    expect(currentOriginSecret(undefined)).toBeUndefined();
    expect(currentOriginSecret('')).toBeUndefined();
    expect(currentOriginSecret(' , ')).toBeUndefined();
  });
});
