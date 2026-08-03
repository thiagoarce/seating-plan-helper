/**
 * The printable page (TECHNICAL_SPEC §11).
 *
 * One component serves the on-screen preview, the SVG file, the PNG raster, the
 * PDF, and the print view. Colours are declared as literal values inside the
 * document's own `<style>` block rather than inherited from the app theme,
 * because an exported .svg has to stand alone — and because the page is printed
 * on white paper regardless of whether the teacher uses dark mode.
 */

import { SEAT_SIZE } from '../domain/defaults';
import { unionBounds } from '../domain/geometry';
import type { SeatingProject } from '../domain/types';
import type { MessageCatalog } from '../i18n/format';
import { formatMessage } from '../i18n/format';
import { RoomLayer, buildSeatPresentations } from '../shared/RoomGraphics';
import type { RoomViewOptions, SeatPresentation } from '../shared/RoomGraphics';
import { fitTransform, pageDimensions, wrapName } from './page';

const HEADER_HEIGHT = 72;
const FOOTER_HEIGHT = 28;
const LOGO_MAX_HEIGHT = 52;

/** Light, print-safe palette. Mirrors the token names used by the components. */
const PRINT_PALETTE = `
  svg.plan-document {
    --text: #14181f;
    --text-muted: #5b6472;
    --border: #c8ccd4;
    --border-strong: #9aa1ac;
    --seat-fill: #ffffff;
    --seat-empty-fill: #f3f5f8;
    --seat-stroke: #6f7885;
    --center-fill: #eef1f6;
    --object-fill: #dfe4ec;
    --region-stroke: #8492a5;
    --danger: #a12c22;
    --accent: #1f3a5f;
    font-family: 'Segoe UI', system-ui, -apple-system, Helvetica, Arial, sans-serif;
  }
`;

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

/**
 * Reports what would look wrong on paper before the user exports
 * (PRODUCT_SPEC §5.7, §9).
 */
export function analysePlan(project: SeatingProject): PlanDiagnostics {
  const options = viewOptions(project);
  const studentNameById = new Map(project.roster.map((student) => [student.id, student.name]));
  const placement = new Map(project.assignments.map((item) => [item.studentId, item.seatId]));
  const seats = buildSeatPresentations(project.room, placement, studentNameById);

  const overflowingNames: string[] = [];
  for (const seat of seats) {
    if (!seat.studentName) continue;
    const wrapped = wrapName(seat.studentName, {
      maxWidth: SEAT_SIZE - 8,
      maxLines: 3,
      fontSize: 11 * options.fontScale,
      minFontSize: 6,
    });
    if (wrapped.overflows) overflowingNames.push(seat.studentName);
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

export function PlanDocument({
  project,
  catalog,
  placement,
  bare = false,
}: PlanDocumentProps): JSX.Element {
  const layout = project.exportLayout;
  const page = bare
    ? { width: project.room.width, height: project.room.height }
    : pageDimensions(layout);

  const margin = bare ? 0 : layout.margin;
  const showHeader = !bare && layout.showHeader;
  const showFooter = !bare && layout.showFooter;

  const headerHeight = showHeader ? HEADER_HEIGHT : 0;
  const footerHeight = showFooter ? FOOTER_HEIGHT : 0;

  const frame = {
    x: margin,
    y: margin + headerHeight,
    width: page.width - margin * 2,
    height: page.height - margin * 2 - headerHeight - footerHeight,
  };

  const fit = fitTransform(
    { width: project.room.width, height: project.room.height },
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

  const { title, subtitle } = headerText(project, catalog);
  const logo = project.branding.showLogo
    ? project.assetStore.assets.find((asset) => asset.id === project.branding.logoAssetId)
    : undefined;

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
      <style>{PRINT_PALETTE}</style>

      {layout.transparentBackground && !bare ? null : (
        <rect x={0} y={0} width={page.width} height={page.height} fill="#ffffff" />
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
            fill={project.branding.primaryColor}
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
            stroke={project.branding.accentColor}
            strokeWidth={1.5}
          />
        </g>
      ) : null}

      <g
        transform={`translate(${frame.x + fit.offsetX} ${frame.y + fit.offsetY}) scale(${fit.scale})`}
      >
        <RoomLayer room={project.room} seats={seats} options={viewOptions(project)} />
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
