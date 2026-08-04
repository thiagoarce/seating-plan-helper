/**
 * Turning the plan document into files (TECHNICAL_SPEC §11).
 *
 * The pipeline is: scene component -> SVG markup -> everything else. SVG is the
 * export format and also the source for the raster and the PDF, so all four
 * outputs are guaranteed to agree with the preview.
 *
 * PDF note: the page embeds a high-resolution raster of the same scene rather
 * than vector text. Emitting vector text would mean embedding font programs,
 * and a wrong or missing glyph silently mangles a student's name — worse than a
 * raster at 3x. The browser's own "print to PDF" path is offered alongside and
 * does produce vector text.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SeatingProject } from '../domain/types';
import type { MessageCatalog } from '../i18n/format';
import { PlanDocument } from './PlanDocument';
import { pageDimensions, screenLongEdgePixels } from './page';

/** Raster scale for PNG and PDF. 3x on A4 lands around 250 dpi. */
export const DEFAULT_RASTER_SCALE = 3;

/**
 * How far to scale the composition when rasterizing.
 *
 * Paper wants print resolution. A screen-sized export instead has to land on
 * exact pixel dimensions — a wallpaper that is not the display's own size gets
 * rescaled by the operating system, which is what makes text look soft.
 */
export function rasterScaleFor(layout: SeatingProject['exportLayout']): number {
  const targetPixels = screenLongEdgePixels(layout);
  if (targetPixels === null) return DEFAULT_RASTER_SCALE;

  const { width, height } = pageDimensions(layout);
  return targetPixels / Math.max(width, height);
}

export interface RenderInput {
  project: SeatingProject;
  catalog: MessageCatalog;
  placement?: ReadonlyMap<string, string>;
}

export function renderPlanSvg(input: RenderInput): string {
  const markup = renderToStaticMarkup(
    createElement(PlanDocument, {
      project: input.project,
      catalog: input.catalog,
      ...(input.placement ? { placement: input.placement } : {}),
    }),
  );
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n${markup}`;
}

function svgBlob(svg: string): Blob {
  return new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not rasterize the plan'));
    image.src = url;
  });
}

export interface RasterOptions {
  scale?: number;
  /** Ignored for JPEG output, which has no alpha channel. */
  transparent?: boolean;
}

/** Rasterizes the plan onto a canvas at `scale` times its point size. */
async function rasterize(
  input: RenderInput,
  options: RasterOptions = {},
): Promise<HTMLCanvasElement> {
  const scale = options.scale ?? rasterScaleFor(input.project.exportLayout);
  const { width, height } = pageDimensions(input.project.exportLayout);

  const svg = renderPlanSvg(input);
  const url = URL.createObjectURL(svgBlob(svg));

  try {
    const image = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);

    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D context unavailable');

    if (!options.transparent) {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function renderPlanPng(
  input: RenderInput,
  options: RasterOptions = {},
): Promise<Blob> {
  const transparent = options.transparent ?? input.project.exportLayout.transparentBackground;
  const canvas = await rasterize(input, { ...options, transparent });

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not encode the PNG'));
    }, 'image/png');
  });
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function latin1(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

/**
 * Minimal single-page PDF containing one JPEG-encoded image scaled to the page.
 * Hand-written rather than pulled from a library: the document has exactly five
 * objects and no font handling, so a dependency would cost more than it saves.
 */
function buildPdf(
  jpegBytes: Uint8Array,
  imageSize: { width: number; height: number },
  page: { width: number; height: number },
): Blob {
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let position = 0;

  const push = (chunk: string | Uint8Array): void => {
    const bytes = typeof chunk === 'string' ? latin1(chunk) : chunk;
    parts.push(bytes);
    position += bytes.length;
  };

  const startObject = (): void => {
    offsets.push(position);
  };

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

  startObject();
  push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  startObject();
  push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');

  startObject();
  push(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width.toFixed(2)} ${page.height.toFixed(
      2,
    )}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>\nendobj\n`,
  );

  const content = `q\n${page.width.toFixed(2)} 0 0 ${page.height.toFixed(2)} 0 0 cm\n/Im0 Do\nQ\n`;
  startObject();
  push(`4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`);

  startObject();
  push(
    `5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imageSize.width} /Height ${imageSize.height} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`,
  );
  push(jpegBytes);
  push('\nendstream\nendobj\n');

  const xrefOffset = position;
  const objectCount = offsets.length + 1;
  let xref = `xref\n0 ${objectCount}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  }
  push(xref);
  push(
    `trailer\n<< /Size ${objectCount} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  );

  return new Blob(parts as BlobPart[], { type: 'application/pdf' });
}

export async function renderPlanPdf(
  input: RenderInput,
  options: RasterOptions = {},
): Promise<Blob> {
  const canvas = await rasterize(input, { ...options, transparent: false });
  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const page = pageDimensions(input.project.exportLayout);

  return buildPdf(
    base64ToBytes(base64),
    { width: canvas.width, height: canvas.height },
    page,
  );
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoked on the next tick so the download has certainly started.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadText(text: string, filename: string, mimeType: string): void {
  downloadBlob(new Blob([text], { type: `${mimeType};charset=utf-8` }), filename);
}

/**
 * Prints through a detached iframe so the page keeps its own layout and the
 * browser's vector pipeline is used (the only path that produces selectable
 * text in a PDF).
 */
export function printPlan(input: RenderInput): void {
  const svg = renderPlanSvg(input);
  const { width, height } = pageDimensions(input.project.exportLayout);

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  if (!doc) {
    iframe.remove();
    return;
  }

  doc.open();
  doc.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(
      input.project.metadata.title ?? '',
    )}</title><style>` +
      `@page{size:${width.toFixed(2)}pt ${height.toFixed(2)}pt;margin:0}` +
      'html,body{margin:0;padding:0}svg{display:block;width:100%;height:auto}' +
      `</style></head><body>${svg.slice(svg.indexOf('<svg'))}</body></html>`,
  );
  doc.close();

  const cleanup = (): void => {
    setTimeout(() => iframe.remove(), 1000);
  };

  iframe.contentWindow?.addEventListener('afterprint', cleanup);
  // Give the browser a frame to lay the SVG out before opening the dialog.
  setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    cleanup();
  }, 100);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Filename stem built from the class and period, safe on every platform. */
export function planFilename(project: SeatingProject, extension: string): string {
  const parts = [
    project.metadata.className ?? project.metadata.title ?? 'mapa-de-sala',
    project.metadata.month && project.metadata.year
      ? `${String(project.metadata.month).padStart(2, '0')}-${project.metadata.year}`
      : '',
  ].filter(Boolean);

  const stem = parts
    .join('-')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLocaleLowerCase();

  return `${stem || 'mapa-de-sala'}.${extension}`;
}
