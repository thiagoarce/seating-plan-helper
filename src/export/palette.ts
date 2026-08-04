/**
 * Colour for the exported plan (TECHNICAL_SPEC §11).
 *
 * The document carries its own literal colours rather than inheriting the
 * app's theme: an exported .svg has to stand alone, and a plan printed on
 * paper is a different medium from the screen it was composed on.
 */

import type { ExportLayout } from '../domain/types';

export interface PlanPalette {
  background: string;
  text: string;
  textMuted: string;
  border: string;
  borderStrong: string;
  /** An occupied desk. Reads as a card lifted off the page. */
  seatFill: string;
  seatEmptyFill: string;
  seatStroke: string;
  centerFill: string;
  objectFill: string;
  regionStroke: string;
  danger: string;
  accent: string;
}

const LIGHT_PALETTE: PlanPalette = {
  background: '#ffffff',
  text: '#14181f',
  textMuted: '#5b6472',
  border: '#c8ccd4',
  borderStrong: '#9aa1ac',
  seatFill: '#ffffff',
  seatEmptyFill: '#f3f5f8',
  seatStroke: '#6f7885',
  centerFill: '#eef1f6',
  objectFill: '#dfe4ec',
  regionStroke: '#8492a5',
  danger: '#a12c22',
  accent: '#1f3a5f',
};

/**
 * True black, not a dark grey: the plan is often set as a wallpaper, and on an
 * OLED display a black background costs no light at all. Desks are lifted just
 * far enough off it to read as cards without glowing.
 */
const DARK_PALETTE: PlanPalette = {
  background: '#000000',
  text: '#f4f6f9',
  textMuted: '#98a2b0',
  border: '#333a44',
  borderStrong: '#59626e',
  seatFill: '#1b2129',
  seatEmptyFill: '#0a0d11',
  seatStroke: '#7d8794',
  centerFill: '#0e1218',
  objectFill: '#1b2129',
  regionStroke: '#6b7684',
  danger: '#ff6f61',
  accent: '#7fb2ea',
};

export function planPalette(layout: ExportLayout): PlanPalette {
  return layout.theme === 'dark' ? DARK_PALETTE : LIGHT_PALETTE;
}

/** The palette as the `<style>` block the document embeds. */
export function paletteCss(palette: PlanPalette): string {
  return `
  svg.plan-document {
    --text: ${palette.text};
    --text-muted: ${palette.textMuted};
    --border: ${palette.border};
    --border-strong: ${palette.borderStrong};
    --seat-fill: ${palette.seatFill};
    --seat-empty-fill: ${palette.seatEmptyFill};
    --seat-stroke: ${palette.seatStroke};
    --center-fill: ${palette.centerFill};
    --object-fill: ${palette.objectFill};
    --region-stroke: ${palette.regionStroke};
    --danger: ${palette.danger};
    --accent: ${palette.accent};
    font-family: 'Segoe UI', system-ui, -apple-system, Helvetica, Arial, sans-serif;
  }
`;
}

// ---------------------------------------------------------------------------
// Contrast
// ---------------------------------------------------------------------------

function parseHex(color: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return null;

  const digits = match[1]!;
  const full =
    digits.length === 3
      ? digits
          .split('')
          .map((digit) => digit + digit)
          .join('')
      : digits;

  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

/** WCAG relative luminance. */
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (value: number): number => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const first = parseHex(a);
  const second = parseHex(b);
  // An unparseable colour is assumed fine rather than silently overridden —
  // the user typed it, and refusing to show it would be the bigger surprise.
  if (!first || !second) return Number.POSITIVE_INFINITY;

  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG's large-text threshold, which is what the heading and rule are. */
const MIN_HEADING_CONTRAST = 3;

/**
 * The school's own colour when it is readable on this background, and the
 * palette's own colour when it is not.
 *
 * A school's brand colour is usually a dark navy or maroon chosen against
 * white; on a black background it disappears. Keeping it anyway would mean
 * exporting a heading nobody can read.
 */
export function readableBrandColor(brandColor: string, palette: PlanPalette): string {
  return contrastRatio(brandColor, palette.background) >= MIN_HEADING_CONTRAST
    ? brandColor
    : palette.text;
}
