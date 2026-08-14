import { describe, it, expect } from 'vitest';
import { formatOrderLabel } from '@label-engine/model/labelNumbering';

describe('formatOrderLabel', () => {
  it('numeric 1..n', () => {
    expect(formatOrderLabel('numeric', 0, 5)).toBe('1');
    expect(formatOrderLabel('numeric', 4, 5)).toBe('5');
  });

  it('numeric-padded pads to total width', () => {
    expect(formatOrderLabel('numeric-padded', 0, 5)).toBe('01');
    expect(formatOrderLabel('numeric-padded', 4, 5)).toBe('05');
    expect(formatOrderLabel('numeric-padded', 9, 12)).toBe('10');
  });

  it('alpha-upper generates A, B, C…', () => {
    expect(formatOrderLabel('alpha-upper', 0, 3)).toBe('A');
    expect(formatOrderLabel('alpha-upper', 1, 3)).toBe('B');
    expect(formatOrderLabel('alpha-upper', 25, 26)).toBe('Z');
  });

  it('roman-upper generates roman numerals', () => {
    expect(formatOrderLabel('roman-upper', 0, 4)).toBe('I');
    expect(formatOrderLabel('roman-upper', 3, 4)).toBe('IV');
    expect(formatOrderLabel('roman-upper', 8, 10)).toBe('IX');
  });

  it('roman-lower is lowercased', () => {
    expect(formatOrderLabel('roman-lower', 0, 1)).toBe('i');
  });

  it('parent-dash uses parent code when provided', () => {
    expect(formatOrderLabel('parent-dash', 0, 3, 'A')).toBe('A-1');
    expect(formatOrderLabel('parent-dash', 2, 3, 'B')).toBe('B-3');
  });

  it('parent-dash falls back to alpha when no parent', () => {
    expect(formatOrderLabel('parent-dash', 1, 5)).toBe('B');
  });

  it('parent-compact uses parent code without dash', () => {
    expect(formatOrderLabel('parent-compact', 0, 3, 'A')).toBe('A1');
  });

  it('circled mode returns index+1 as number', () => {
    expect(formatOrderLabel('circled', 2, 5)).toBe('3');
  });
});
