import { describe, expect, it } from 'vitest';
import { createDefaultExportLayout } from '../domain/defaults';
import type { ExportLayout } from '../domain/types';
import { contrastRatio, paletteCss, planPalette, readableBrandColor } from './palette';

const layout = (theme: ExportLayout['theme']): ExportLayout => ({
  ...createDefaultExportLayout(),
  theme,
});

const DARK = planPalette(layout('dark'));
const LIGHT = planPalette(layout('light'));

/** Every colour the document paints text or a line in. */
const FOREGROUNDS = ['text', 'textMuted', 'seatStroke', 'regionStroke', 'danger'] as const;

describe('contrastRatio', () => {
  it('is 21 for black against white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 4);
  });

  it('is 1 for a colour against itself', () => {
    expect(contrastRatio('#3a7bd5', '#3a7bd5')).toBeCloseTo(1, 6);
  });

  it('does not care which colour is given first', () => {
    expect(contrastRatio('#123456', '#fedcba')).toBeCloseTo(contrastRatio('#fedcba', '#123456'), 6);
  });

  it('accepts shorthand hex', () => {
    expect(contrastRatio('#fff', '#ffffff')).toBeCloseTo(1, 6);
  });

  it('treats an unparseable colour as acceptable rather than overriding it', () => {
    expect(contrastRatio('var(--brand)', '#000000')).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('planPalette', () => {
  it('paints the dark theme on true black', () => {
    expect(DARK.background).toBe('#000000');
  });

  it('keeps light the default', () => {
    expect(planPalette(createDefaultExportLayout()).background).toBe('#ffffff');
  });

  it.each(FOREGROUNDS)('gives dark-theme %s readable contrast on the background', (token) => {
    expect(contrastRatio(DARK[token], DARK.background)).toBeGreaterThanOrEqual(3);
  });

  it.each(FOREGROUNDS)('gives light-theme %s readable contrast on the background', (token) => {
    expect(contrastRatio(LIGHT[token], LIGHT.background)).toBeGreaterThanOrEqual(3);
  });

  it('keeps a student name readable on the desk it sits in', () => {
    expect(contrastRatio(DARK.text, DARK.seatFill)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(LIGHT.text, LIGHT.seatFill)).toBeGreaterThanOrEqual(4.5);
  });

  it('tells an occupied desk apart from an empty one', () => {
    expect(DARK.seatFill).not.toBe(DARK.seatEmptyFill);
    expect(contrastRatio(DARK.seatFill, DARK.seatEmptyFill)).toBeGreaterThan(1.05);
  });

  it('emits every token into the stylesheet', () => {
    const css = paletteCss(DARK);
    for (const value of Object.values(DARK)) {
      if (value === DARK.background) continue; // painted as a rect, not a token
      expect(css).toContain(value);
    }
  });
});

describe('readableBrandColor', () => {
  it('keeps a brand colour that reads on the background', () => {
    // The default navy is chosen against white and works there.
    expect(readableBrandColor('#1f3a5f', LIGHT)).toBe('#1f3a5f');
  });

  it('drops a brand colour that would vanish into black', () => {
    expect(readableBrandColor('#1f3a5f', DARK)).toBe(DARK.text);
  });

  it('keeps a bright brand colour on the dark theme', () => {
    expect(readableBrandColor('#ffd166', DARK)).toBe('#ffd166');
  });

  it('drops a pale brand colour that would vanish into white', () => {
    expect(readableBrandColor('#f2f4f7', LIGHT)).toBe(LIGHT.text);
  });
});
