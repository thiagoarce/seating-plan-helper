/**
 * Page geometry and text fitting for the export composition
 * (TECHNICAL_SPEC §11).
 *
 * Page dimensions are in PostScript points (1/72 inch), which is what PDF uses
 * natively and what browsers assume when printing an SVG at a physical size.
 */

import type { ExportLayout, PageSize } from '../domain/types';

export interface PageDimensions {
  width: number;
  height: number;
}

/**
 * Portrait-orientation base sizes; `pageDimensions` swaps them for landscape.
 *
 * The screen sizes are given in the same units as the paper ones rather than in
 * pixels on purpose: the header, the margins and the title are all absolute
 * sizes, so a canvas measured in thousands would render them as specks. The
 * raster step scales the whole composition up to real pixels instead
 * (`screenLongEdgePixels`).
 */
const PAGE_SIZES: Record<PageSize, PageDimensions> = {
  A4: { width: 595.28, height: 841.89 },
  Letter: { width: 612, height: 792 },
  'screen-16-9': { width: 540, height: 960 },
  'screen-16-10': { width: 600, height: 960 },
};

/** Long edge, in pixels, that a screen-sized export rasterizes to. */
const SCREEN_LONG_EDGE_PIXELS = 1920;

export function isScreenSize(pageSize: PageSize): boolean {
  return pageSize.startsWith('screen-');
}

/**
 * Pixels along the export's long edge, or null for paper sizes — which are
 * measured in points and rasterize at a print resolution instead.
 */
export function screenLongEdgePixels(layout: ExportLayout): number | null {
  return isScreenSize(layout.pageSize) ? SCREEN_LONG_EDGE_PIXELS : null;
}

export function pageDimensions(layout: ExportLayout): PageDimensions {
  const base = PAGE_SIZES[layout.pageSize];
  return layout.orientation === 'landscape'
    ? { width: base.height, height: base.width }
    : { width: base.width, height: base.height };
}

/** Shortens a name according to the chosen style (PRODUCT_SPEC §5.7). */
export function displayName(name: string, style: ExportLayout['nameStyle']): string {
  const trimmed = name.trim();
  if (style === 'full' || trimmed.length === 0) return trimmed;

  const parts = trimmed.split(/\s+/);
  const first = parts[0] ?? trimmed;
  if (style === 'firstName') return first;

  const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
  return last ? `${first} ${last.charAt(0).toLocaleUpperCase()}.` : first;
}

/**
 * Rough advance width of a string at a given font size.
 *
 * Measuring text properly needs a canvas or a font metrics table, neither of
 * which is available while building a pure scene description. A per-character
 * average is enough for the only decision that depends on it: warning the user
 * that names will not fit (PRODUCT_SPEC §5.7).
 */
const AVERAGE_GLYPH_RATIO = 0.52;

export function estimateTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * AVERAGE_GLYPH_RATIO;
}

export interface WrappedText {
  lines: string[];
  fontSize: number;
  /** True when the text still overflows at the smallest allowed size. */
  overflows: boolean;
}

export interface WrapOptions {
  maxWidth: number;
  maxLines: number;
  fontSize: number;
  minFontSize: number;
}

/**
 * Wraps a name onto at most `maxLines` lines, shrinking the font a step at a
 * time until it fits. Reports overflow instead of silently clipping.
 */
export function wrapName(text: string, options: WrapOptions): WrappedText {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return { lines: [], fontSize: options.fontSize, overflows: false };
  }

  for (let fontSize = options.fontSize; fontSize >= options.minFontSize; fontSize -= 0.5) {
    const lines: string[] = [];
    let current = '';

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (estimateTextWidth(candidate, fontSize) <= options.maxWidth || current === '') {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);

    const fits =
      lines.length <= options.maxLines &&
      lines.every((line) => estimateTextWidth(line, fontSize) <= options.maxWidth);

    if (fits) return { lines, fontSize, overflows: false };
  }

  // Nothing fits: return the smallest attempt so the user still sees the name,
  // flagged so the UI can warn about readability.
  const lines = [text.trim()];
  return { lines, fontSize: options.minFontSize, overflows: true };
}

/** Scale and offset that fit `content` inside `frame` without distortion. */
export function fitTransform(
  content: { width: number; height: number },
  frame: { width: number; height: number },
): { scale: number; offsetX: number; offsetY: number } {
  if (content.width <= 0 || content.height <= 0) {
    return { scale: 1, offsetX: 0, offsetY: 0 };
  }
  const scale = Math.min(frame.width / content.width, frame.height / content.height);
  return {
    scale,
    offsetX: (frame.width - content.width * scale) / 2,
    offsetY: (frame.height - content.height * scale) / 2,
  };
}
