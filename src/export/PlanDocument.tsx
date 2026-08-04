/**
 * The printable page (TECHNICAL_SPEC §11).
 *
 * One component serves the on-screen preview, the SVG file, the PNG raster, the
 * PDF, and the print view. Colours are declared as literal values inside the
 * document's own `<style>` block rather than inherited from the app theme,
 * because an exported .svg has to stand alone. The document's own light/dark
 * choice (`exportLayout.theme`) is a property of the artefact — a plan headed
 * for a display is a different thing from one headed for paper — and is
 * deliberately independent of whatever theme the teacher composes it in.
 */

import { rotatedBounds, unionBounds } from '../domain/geometry';
import type { Rect, RoomDefinition, SeatingProject } from '../domain/types';
import type { MessageCatalog } from '../i18n/format';
import { formatMessage } from '../i18n/format';
import {
  RoomLayer,
  buildSeatPresentations,
  fitSeatNameSize,
  planNameFontSize,
  wrapSeatNameAt,
} from '../shared/RoomGraphics';
import type { RoomViewOptions, SeatPresentation } from '../shared/RoomGraphics';
import { displayName, estimateTextWidth, fitTransform, pageDimensions } from './page';
import { paletteCss, planPalette, readableBrandColor } from './palette';

const HEADER_HEIGHT = 72;
const FOOTER_HEIGHT = 28;
const LOGO_MAX_HEIGHT = 52;

export interface PlanDocumentProps {
  project: SeatingProject;
  catalog: MessageCatalog;
  /** Overrides the project's assignments, used for suggestion previews. */
  placement?: ReadonlyMap<string, string>;
  /** Renders without header, footer, or margins — for small previews. */
  bare?: boolean;
}

export interface PlanDiagnostics {
  /** Names that could not be made to fit inside their seat. */
  overflowingNames: string[];
  /** Items whose geometry falls outside the room bounds. */
  offCanvas: boolean;
}

function viewOptions(project: SeatingProject): RoomViewOptions {
  const layout = project.exportLayout;
  return {
    showRegions: layout.showRegions,
    showObjects: layout.showRoomObjects,
    showSeats: layout.showSeats,
    showEmptySeats: layout.showEmptySeats,
    showCenterOutlines: true,
    nameStyle: layout.nameStyle,
    fontScale: layout.fontScale,
  };
}

/** Breathing room left around the drawing when cropping to content. */
const CONTENT_PADDING = 20;

function regionBounds(geometry: RoomDefinition['regions'][number]['geometry']): Rect | null {
  if (geometry.type === 'rectangle') return geometry;
  return unionBounds(
    geometry.points.map((point) => ({ x: point.x, y: point.y, width: 0, height: 0 })),
  );
}

/**
 * The rectangle the drawing is framed against: everything actually visible,
 * plus padding — or the whole room when `fitToContent` is off.
 */
export function contentBounds(project: SeatingProject, options: RoomViewOptions): Rect {
  const room = project.room;
  const whole: Rect = { x: 0, y: 0, width: room.width, height: room.height };
  if (!project.exportLayout.fitToContent) return whole;

  const rects: Rect[] = [];
  if (options.showSeats) {
    for (const center of room.centers) rects.push(rotatedBounds(center, center.rotation));
  }
  if (options.showObjects) {
    for (const object of room.objects.filter((item) => item.visibleInExport)) {
      rects.push(rotatedBounds(object, object.rotation));
    }
  }
  if (options.showRegions) {
    for (const region of room.regions.filter((item) => item.visibleInExport)) {
      const bounds = regionBounds(region.geometry);
      if (bounds) rects.push(bounds);
    }
  }
  for (const label of room.labels.filter((item) => item.visibleInExport)) {
    rects.push({
      x: label.x,
      y: label.y - label.fontSize,
      width: estimateTextWidth(label.text, label.fontSize),
      height: label.fontSize * 1.3,
    });
  }

  const union = unionBounds(rects);
  if (!union || union.width <= 0 || union.height <= 0) return whole;

  return {
    x: union.x - CONTENT_PADDING,
    y: union.y - CONTENT_PADDING,
    width: union.width + CONTENT_PADDING * 2,
    height: union.height + CONTENT_PADDING * 2,
  };
}

/**
 * Reports what would look wrong on paper before the user exports
 * (PRODUCT_SPEC §5.7, §9).
 */
export function analysePlan(project: SeatingProject): PlanDiagnostics {
  const options = viewOptions(project);
  const studentNameById = new Map(project.roster.map((student) => [student.id, student.name]));
  const placement = new Map(project.assignments.map((item) => [item.studentId, item.seatId]));
  const seats = buildSeatPresentations(project.room, placement, studentNameById);

  // A name "overflows" when it cannot be made to fit even at the smallest
  // size the renderer will draw — `fitSeatNameSize` bottoms out there.
  const overflowingNames: string[] = [];
  for (const presentation of seats) {
    const { studentName, seat } = presentation;
    if (!studentName) continue;
    const label = displayName(studentName, options.nameStyle);
    const size = fitSeatNameSize(label, seat, 11 * options.fontScale);
    if (wrapSeatNameAt(label, seat, size).overflows) overflowingNames.push(studentName);
  }

  const bounds = unionBounds([
    ...project.room.centers.map((center) => ({
      x: center.x,
      y: center.y,
      width: center.width,
      height: center.height,
    })),
    ...project.room.objects.map((object) => ({
      x: object.x,
      y: object.y,
      width: object.width,
      height: object.height,
    })),
  ]);

  const offCanvas =
    bounds !== null &&
    (bounds.x < 0 ||
      bounds.y < 0 ||
      bounds.x + bounds.width > project.room.width ||
      bounds.y + bounds.height > project.room.height);

  return { overflowingNames, offCanvas };
}

function headerText(project: SeatingProject, catalog: MessageCatalog): {
  title: string;
  subtitle: string;
} {
  const { metadata } = project;
  const title = metadata.title?.trim() || formatMessage(catalog, 'plan.title');
  const period =
    metadata.month && metadata.year
      ? `${String(metadata.month).padStart(2, '0')}/${metadata.year}`
      : metadata.year
        ? String(metadata.year)
        : '';

  const subtitle = [metadata.schoolName, metadata.className, metadata.teacherName, period]
    .map((part) => part?.toString().trim())
    .filter((part): part is string => Boolean(part))
    .join(' · ');

  return { title, subtitle };
}

/** Page box and the rectangle the drawing is framed into, for a given mode. */
function planLayout(project: SeatingProject, bare: boolean) {
  const layout = project.exportLayout;
  const page = bare
    ? { width: project.room.width, height: project.room.height }
    : pageDimensions(layout);

  const margin = bare ? 0 : layout.margin;
  const headerHeight = !bare && layout.showHeader ? HEADER_HEIGHT : 0;
  const footerHeight = !bare && layout.showFooter ? FOOTER_HEIGHT : 0;

  return {
    page,
    margin,
    frame: {
      x: margin,
      y: margin + headerHeight,
      width: page.width - margin * 2,
      height: page.height - margin * 2 - headerHeight - footerHeight,
    },
  };
}

/**
 * How much the drawing is shrunk to fit the page. Student names are drawn in
 * room units, so their size on paper is this times their nominal font size —
 * which is why a room much larger than its furniture prints unreadably.
 */
export function planFitScale(project: SeatingProject): number {
  const { frame } = planLayout(project, false);
  const view = contentBounds(project, viewOptions(project));
  return fitTransform(
    { width: view.width, height: view.height },
    { width: frame.width, height: frame.height },
  ).scale;
}

export function PlanDocument({
  project,
  catalog,
  placement,
  bare = false,
}: PlanDocumentProps): JSX.Element {
  const layout = project.exportLayout;
  const { page, margin, frame } = planLayout(project, bare);
  const showHeader = !bare && layout.showHeader;
  const showFooter = !bare && layout.showFooter;
  const headerHeight = showHeader ? HEADER_HEIGHT : 0;

  const options = viewOptions(project);
  // Previews render the room rectangle itself as the page, so they frame the
  // whole room; the printed page zooms to what is actually drawn.
  const view = bare
    ? { x: 0, y: 0, width: project.room.width, height: project.room.height }
    : contentBounds(project, options);

  const fit = fitTransform(
    { width: view.width, height: view.height },
    { width: frame.width, height: frame.height },
  );

  const studentNameById = new Map(project.roster.map((student) => [student.id, student.name]));
  const effectivePlacement =
    placement ?? new Map(project.assignments.map((item) => [item.studentId, item.seatId]));
  const lockedStudentIds = new Set(
    project.assignments.filter((item) => item.locked).map((item) => item.studentId),
  );

  const seats: SeatPresentation[] = buildSeatPresentations(
    project.room,
    effectivePlacement,
    studentNameById,
    lockedStudentIds,
  );

  // One size for every name on the page, so no student's name prints smaller
  // than the rest just because theirs is longer.
  const drawOptions: RoomViewOptions = {
    ...options,
    nameFontSize: planNameFontSize(seats, options.nameStyle, options.fontScale),
  };

  const { title, subtitle } = headerText(project, catalog);
  const logo = project.branding.showLogo
    ? project.assetStore.assets.find((asset) => asset.id === project.branding.logoAssetId)
    : undefined;

  const palette = planPalette(layout);
  // A school's brand colour is normally picked against white; on a black page
  // it vanishes, so it is used only where it still reads.
  const titleColor = readableBrandColor(project.branding.primaryColor, palette);
  const ruleColor = readableBrandColor(project.branding.accentColor, palette);

  const logoHeight = logo ? Math.min(LOGO_MAX_HEIGHT, headerHeight - 16) : 0;
  const logoWidth = logo && logo.height > 0 ? (logo.width / logo.height) * logoHeight : 0;
  const textLeft = margin + (logoWidth > 0 ? logoWidth + 12 : 0);

  return (
    <svg
      className="plan-document"
      xmlns="http://www.w3.org/2000/svg"
      xmlnsXlink="http://www.w3.org/1999/xlink"
      viewBox={`0 0 ${page.width} ${page.height}`}
      width={page.width}
      height={page.height}
      role="img"
      aria-label={title}
    >
      <style>{paletteCss(palette)}</style>

      {layout.transparentBackground && !bare ? null : (
        <rect x={0} y={0} width={page.width} height={page.height} fill={palette.background} />
      )}

      {showHeader ? (
        <g>
          {logo && logoWidth > 0 ? (
            <image
              href={logo.dataUrl}
              x={margin}
              y={margin + (headerHeight - logoHeight) / 2 - 8}
              width={logoWidth}
              height={logoHeight}
              preserveAspectRatio="xMidYMid meet"
            />
          ) : null}
          <text
            x={textLeft}
            y={margin + 26}
            fontSize={20}
            fontWeight={700}
            fill={titleColor}
          >
            {title}
          </text>
          {subtitle ? (
            <text x={textLeft} y={margin + 46} fontSize={11} fill="var(--text-muted)">
              {subtitle}
            </text>
          ) : null}
          <line
            x1={margin}
            y1={margin + headerHeight - 14}
            x2={page.width - margin}
            y2={margin + headerHeight - 14}
            stroke={ruleColor}
            strokeWidth={1.5}
          />
        </g>
      ) : null}

      <g
        transform={`translate(${frame.x + fit.offsetX} ${frame.y + fit.offsetY}) scale(${fit.scale}) translate(${-view.x} ${-view.y})`}
      >
        <RoomLayer room={project.room} seats={seats} options={drawOptions} />
      </g>

      {showFooter ? (
        <g>
          <text
            x={margin}
            y={page.height - margin - 6}
            fontSize={9}
            fill="var(--text-muted)"
          >
            {layout.footerText?.trim() || project.metadata.notes?.trim() || ''}
          </text>
        </g>
      ) : null}
    </svg>
  );
}
