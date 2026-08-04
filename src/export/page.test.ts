import { describe, expect, it } from 'vitest';
import { createDefaultExportLayout } from '../domain/defaults';
import type { ExportLayout } from '../domain/types';
import {
  displayName,
  fitTransform,
  isScreenSize,
  pageDimensions,
  screenLongEdgePixels,
  wrapName,
} from './page';

describe('pageDimensions', () => {
  it('returns A4 portrait', () => {
    const layout = { ...createDefaultExportLayout(), orientation: 'portrait' as const };
    const { width, height } = pageDimensions(layout);
    expect(width).toBeCloseTo(595.28);
    expect(height).toBeCloseTo(841.89);
  });

  it('swaps the axes for landscape', () => {
    const layout = { ...createDefaultExportLayout(), orientation: 'landscape' as const };
    const { width, height } = pageDimensions(layout);
    expect(width).toBeCloseTo(841.89);
    expect(height).toBeCloseTo(595.28);
  });

  it('supports Letter', () => {
    const layout = {
      ...createDefaultExportLayout(),
      pageSize: 'Letter' as const,
      orientation: 'portrait' as const,
    };
    expect(pageDimensions(layout)).toEqual({ width: 612, height: 792 });
  });
});

describe('displayName', () => {
  it('keeps the full name', () => {
    expect(displayName('Maria Eduarda Souza', 'full')).toBe('Maria Eduarda Souza');
  });

  it('keeps only the first name', () => {
    expect(displayName('Maria Eduarda Souza', 'firstName')).toBe('Maria');
  });

  it('abbreviates the last name', () => {
    expect(displayName('Maria Eduarda Souza', 'firstNameLastInitial')).toBe('Maria S.');
  });

  it('handles single-word names', () => {
    expect(displayName('João', 'firstNameLastInitial')).toBe('João');
  });

  it('preserves accents in the initial', () => {
    expect(displayName('Ana Ávila', 'firstNameLastInitial')).toBe('Ana Á.');
  });

  it('handles empty input', () => {
    expect(displayName('   ', 'firstName')).toBe('');
  });
});

describe('wrapName', () => {
  const options = { maxWidth: 60, maxLines: 2, fontSize: 12, minFontSize: 7 };

  it('keeps a short name on one line at full size', () => {
    const result = wrapName('Ana', options);
    expect(result.lines).toEqual(['Ana']);
    expect(result.fontSize).toBe(12);
    expect(result.overflows).toBe(false);
  });

  it('wraps a two-word name onto two lines', () => {
    const result = wrapName('Maria Eduarda', options);
    expect(result.lines.length).toBeGreaterThan(1);
    expect(result.overflows).toBe(false);
  });

  it('shrinks the font before giving up', () => {
    const result = wrapName('Maria Eduarda Nascimento', options);
    expect(result.fontSize).toBeLessThan(12);
  });

  it('reports overflow for a single unbreakable word that never fits', () => {
    const result = wrapName('Wolfeschlegelsteinhausenbergerdorff', {
      ...options,
      maxWidth: 20,
      minFontSize: 6,
    });
    expect(result.overflows).toBe(true);
    expect(result.lines).toHaveLength(1);
  });

  it('returns nothing for blank input', () => {
    expect(wrapName('  ', options).lines).toEqual([]);
  });
});

describe('fitTransform', () => {
  it('scales down to fit and centres', () => {
    const result = fitTransform({ width: 200, height: 100 }, { width: 100, height: 100 });
    expect(result.scale).toBe(0.5);
    expect(result.offsetX).toBe(0);
    expect(result.offsetY).toBe(25);
  });

  it('is safe for degenerate content', () => {
    expect(fitTransform({ width: 0, height: 0 }, { width: 10, height: 10 }).scale).toBe(1);
  });
});

describe('screen sizes', () => {
  const layout = (patch: Partial<ExportLayout>): ExportLayout => ({
    ...createDefaultExportLayout(),
    ...patch,
  });

  it('tells screen sizes apart from paper ones', () => {
    expect(isScreenSize('screen-16-9')).toBe(true);
    expect(isScreenSize('screen-16-10')).toBe(true);
    expect(isScreenSize('A4')).toBe(false);
    expect(isScreenSize('Letter')).toBe(false);
  });

  it.each([
    ['screen-16-9' as const, 16 / 9],
    ['screen-16-10' as const, 16 / 10],
  ])('gives %s the right aspect ratio in landscape', (pageSize, ratio) => {
    const { width, height } = pageDimensions(layout({ pageSize, orientation: 'landscape' }));

    expect(width / height).toBeCloseTo(ratio, 6);
  });

  it('flips the aspect ratio for a portrait screen', () => {
    const portrait = pageDimensions(layout({ pageSize: 'screen-16-9', orientation: 'portrait' }));

    expect(portrait.height / portrait.width).toBeCloseTo(16 / 9, 6);
  });

  it('reports a pixel target only for screen sizes', () => {
    expect(screenLongEdgePixels(layout({ pageSize: 'screen-16-9' }))).toBe(1920);
    expect(screenLongEdgePixels(layout({ pageSize: 'A4' }))).toBeNull();
  });

  it('keeps the composition the same order of magnitude as paper', () => {
    // Header, margins and title are absolute sizes, so a screen page measured
    // in thousands would render them as specks.
    const screen = pageDimensions(layout({ pageSize: 'screen-16-9' }));
    const a4 = pageDimensions(layout({ pageSize: 'A4' }));

    expect(screen.width).toBeGreaterThan(a4.width / 3);
    expect(screen.height).toBeLessThan(a4.height * 3);
  });
});
