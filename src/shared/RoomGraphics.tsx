/**
 * The room drawing, shared by the editor, the export composition, and the
 * suggestion previews.
 *
 * TECHNICAL_SPEC §11 requires a single scene representation for screen and
 * export — no screenshotting the editor. Keeping one set of components means
 * what the teacher sees while editing is literally what gets exported, and it
 * comes out as real SVG with selectable text.
 */

import { Fragment } from 'react';
import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react';
import { SEAT_DEPTH, SEAT_SIZE, SEAT_WIDTH, TRAPEZOID_NARROW_RATIO } from '../domain/defaults';
import { rotatedBounds, seatWorldPosition, seatWorldRotation } from '../domain/geometry';
import type {
  ExportLayout,
  Region,
  RoomDefinition,
  RoomObject,
  Seat,
  SeatingCenter,
  TextLabel,
} from '../domain/types';
import { displayName, wrapName } from '../export/page';
import type { WrappedText } from '../export/page';
import { centerDisplayName } from './labels';

export interface SeatPresentation {
  seat: Seat;
  center: SeatingCenter;
  x: number;
  y: number;
  /** Combined center+seat rotation, for shapes that render direction (§ DeskShape). */
  rotation: number;
  studentName: string | null;
  studentId: string | null;
  locked: boolean;
  violating: boolean;
}

export interface RoomViewOptions {
  showRegions: boolean;
  showObjects: boolean;
  showSeats: boolean;
  showEmptySeats: boolean;
  showCenterOutlines: boolean;
  nameStyle: ExportLayout['nameStyle'];
  fontScale: number;
  /**
   * Small on-canvas captions that help while building the room — the center's
   * own name, and each empty seat's local number. Off by default because the
   * exported/printed plan should show only student names, not internal
   * bookkeeping; the room editor turns these on explicitly.
   */
  showCenterLabels?: boolean;
  showSeatLabels?: boolean;
  /**
   * One name size shared by every desk (see `planNameFontSize`). Without it
   * each desk sizes its own name, so a long name prints noticeably smaller
   * than the short one beside it.
   */
  nameFontSize?: number;
}

export const DEFAULT_ROOM_VIEW_OPTIONS: RoomViewOptions = {
  showRegions: false,
  showObjects: true,
  showSeats: true,
  showEmptySeats: true,
  showCenterOutlines: true,
  nameStyle: 'full',
  fontScale: 1,
};

const SEAT_CORNER = 6;
/**
 * Nominal name size, in room units. Sized against `SEAT_DEPTH` so a name fills
 * the desk it sits in — `fitSeatNameSize` only ever shrinks from here, so a
 * value too small silently caps how large names can print.
 */
export const NAME_BASE_FONT_SIZE = 20;
const NAME_MIN_FONT_SIZE = 7;
/** Band along the desk's front edge held for the chair-back marker. */
const CHAIR_STRIP = 10;
const NAME_LINE_RATIO = 1.15;

/** Unrotated trapezoid: narrow edge at top (toward `rotation`'s direction), wide at bottom. */
function trapezoidPoints(x: number, y: number, half: number): string {
  const narrowHalf = half * TRAPEZOID_NARROW_RATIO;
  const points = [
    [x - narrowHalf, y - half],
    [x + narrowHalf, y - half],
    [x + half, y + half],
    [x - half, y + half],
  ];
  return points.map(([px, py]) => `${px},${py}`).join(' ');
}

/**
 * 90 or 270 when `rotation` lays a desk on its side, 0 otherwise. Half turns
 * and the trapezoid fans' odd angles deliberately return 0: they leave the
 * drawn box the same shape, so the name stays upright and readable.
 */
export function quarterTurn(rotation: number): 0 | 90 | 270 {
  const normalised = ((rotation % 360) + 360) % 360;
  if (normalised === 90) return 90;
  if (normalised === 270) return 270;
  return 0;
}

/** Drawn footprint of a seat's desk, which `deskShape` decides. */
export function seatDeskSize(seat: Seat): { width: number; height: number } {
  return seat.deskShape === 'trapezoid'
    ? { width: SEAT_WIDTH, height: SEAT_SIZE }
    : { width: SEAT_WIDTH, height: SEAT_DEPTH };
}

/**
 * Wraps a name at exactly `fontSize`, reporting overflow rather than shrinking.
 *
 * The line budget comes from the desk's real depth *at this size*: a
 * rectangular desk is only `SEAT_DEPTH` deep, so the three lines this used to
 * allow unconditionally would spill past its top and bottom edges.
 */
export function wrapSeatNameAt(name: string, seat: Seat, fontSize: number): WrappedText {
  const desk = seatDeskSize(seat);
  // A trapezoid tapers toward its narrow edge, so keep text off the slanted
  // sides by budgeting for the narrower half of the wedge.
  const widthInset = seat.deskShape === 'trapezoid' ? desk.width * 0.3 : 16;
  return wrapName(name, {
    maxWidth: desk.width - widthInset,
    maxLines: Math.max(
      1,
      Math.floor((desk.height - CHAIR_STRIP) / (fontSize * NAME_LINE_RATIO)),
    ),
    fontSize,
    // Pinning the floor to the requested size stops wrapName shrinking on its
    // own — the caller decides the size so every desk can share one.
    minFontSize: fontSize,
  });
}

/** Largest size up to `requested` at which `name` fits inside its desk. */
export function fitSeatNameSize(name: string, seat: Seat, requested: number): number {
  for (let size = requested; size > NAME_MIN_FONT_SIZE; size -= 0.5) {
    if (!wrapSeatNameAt(name, seat, size).overflows) return size;
  }
  return NAME_MIN_FONT_SIZE;
}

/**
 * One name size for the whole plan: the largest that every seated student's
 * name can use. Sizing each desk independently — which is what shrinking
 * inside `wrapName` did — left long names visibly smaller than their
 * neighbours across the same chart.
 */
export function planNameFontSize(
  presentations: readonly SeatPresentation[],
  nameStyle: RoomViewOptions['nameStyle'],
  fontScale: number,
): number {
  const requested = NAME_BASE_FONT_SIZE * fontScale;
  let smallest = requested;
  for (const presentation of presentations) {
    if (!presentation.studentName) continue;
    const label = displayName(presentation.studentName, nameStyle);
    smallest = Math.min(smallest, fitSeatNameSize(label, presentation.seat, requested));
  }
  return smallest;
}

/** Builds the per-seat view model the drawing needs. */
export function buildSeatPresentations(
  room: RoomDefinition,
  placement: ReadonlyMap<string, string>,
  studentNameById: ReadonlyMap<string, string>,
  lockedStudentIds: ReadonlySet<string> = new Set(),
  violatingSeatIds: ReadonlySet<string> = new Set(),
): SeatPresentation[] {
  const studentBySeat = new Map<string, string>();
  for (const [studentId, seatId] of placement) studentBySeat.set(seatId, studentId);

  const result: SeatPresentation[] = [];
  for (const center of room.centers) {
    for (const seat of center.seats) {
      const position = seatWorldPosition(center, seat);
      const studentId = studentBySeat.get(seat.id) ?? null;
      result.push({
        seat,
        center,
        x: position.x,
        y: position.y,
        rotation: seatWorldRotation(center, seat),
        studentId,
        studentName: studentId ? (studentNameById.get(studentId) ?? null) : null,
        locked: studentId ? lockedStudentIds.has(studentId) : false,
        violating: violatingSeatIds.has(seat.id),
      });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

export function RegionShape({
  region,
  selected,
}: {
  region: Region;
  selected?: boolean;
}): JSX.Element | null {
  const common = {
    className: `region-rect${selected ? ' selected' : ''}`,
    fill: 'none',
    stroke: 'var(--region-stroke)',
    strokeWidth: selected ? 3 : 1.5,
    strokeDasharray: '10 6',
  };

  if (region.geometry.type === 'rectangle') {
    const { x, y, width, height } = region.geometry;
    return (
      <g className={`region-shape${selected ? ' selected' : ''}`}>
        <rect x={x} y={y} width={width} height={height} rx={4} {...common} />
        <text
          x={x + 8}
          y={y + 18}
          fontSize={13}
          fill="var(--region-stroke)"
          className="seat-name"
        >
          {region.name}
        </text>
      </g>
    );
  }

  const points = region.geometry.points.map((point) => `${point.x},${point.y}`).join(' ');
  const first = region.geometry.points[0];
  return (
    <g className={`region-shape${selected ? ' selected' : ''}`}>
      <polygon points={points} {...common} />
      {first ? (
        <text x={first.x + 8} y={first.y + 18} fontSize={13} fill="var(--region-stroke)">
          {region.name}
        </text>
      ) : null}
    </g>
  );
}

export function ObjectShape({
  object,
  selected,
  onPointerDown,
}: {
  object: RoomObject;
  selected?: boolean;
  onPointerDown?: (event: PointerEvent<SVGGElement>) => void;
}): JSX.Element {
  const bounds = rotatedBounds(object, object.rotation);
  const radius = object.shape === 'roundedRectangle' ? 6 : 0;
  const isLine = object.shape === 'line';
  const labelX = bounds.x + bounds.width / 2;
  const labelY = bounds.y + bounds.height / 2;
  const labelRotation = quarterTurn(object.rotation);

  return (
    <g
      className={`object-shape${selected ? ' selected' : ''}`}
      onPointerDown={onPointerDown}
      style={onPointerDown ? { cursor: 'move' } : undefined}
    >
      <rect
        className="object-rect"
        x={bounds.x}
        y={bounds.y}
        width={bounds.width}
        height={isLine ? Math.min(bounds.height, 4) : bounds.height}
        rx={radius}
        fill={isLine ? 'var(--border-strong)' : 'var(--object-fill)'}
        stroke="var(--border-strong)"
        strokeWidth={1.5}
      />
      {/*
        Turned upright, a board is a tall sliver: a horizontal caption would
        run out past both its edges and collide with whatever stands beside it.
        Turning the caption with the object keeps it along the long side.
      */}
      <text
        className="seat-name"
        x={labelX}
        y={labelY + 4}
        textAnchor="middle"
        fontSize={12}
        fill="var(--text-muted)"
        transform={labelRotation ? `rotate(${labelRotation} ${labelX} ${labelY})` : undefined}
      >
        {object.name}
      </text>
    </g>
  );
}

export function CenterOutline({
  center,
  selected,
  label,
  onPointerDown,
}: {
  center: SeatingCenter;
  selected?: boolean;
  /** Caption shown at the top-left corner, e.g. the center's own name. */
  label?: string;
  onPointerDown?: (event: PointerEvent<SVGGElement>) => void;
}): JSX.Element {
  const bounds = rotatedBounds(center, center.rotation);
  return (
    <g
      className={`center-shape${selected ? ' selected' : ''}`}
      onPointerDown={onPointerDown}
      style={onPointerDown ? { cursor: 'move' } : undefined}
    >
      <rect
        className="center-rect"
        x={bounds.x}
        y={bounds.y}
        width={bounds.width}
        height={bounds.height}
        rx={10}
        fill="var(--center-fill)"
        stroke={selected ? 'var(--accent)' : 'var(--border)'}
        strokeWidth={selected ? 3 : 1.5}
      />
      {label ? (
        <text
          className="seat-name"
          x={bounds.x + 6}
          y={bounds.y + 13}
          fontSize={10}
          fill="var(--text-muted)"
          pointerEvents="none"
        >
          {label}
        </text>
      ) : null}
    </g>
  );
}

export interface SeatShapeProps {
  presentation: SeatPresentation;
  options: RoomViewOptions;
  selected?: boolean;
  dropTarget?: boolean;
  interactive?: boolean;
  onPointerDown?: (event: PointerEvent<SVGGElement>) => void;
  onClick?: (event: MouseEvent<SVGGElement>) => void;
  onKeyDown?: (event: KeyboardEvent<SVGGElement>) => void;
  ariaLabel?: string;
}

export function SeatShape({
  presentation,
  options,
  selected,
  dropTarget,
  interactive,
  onPointerDown,
  onClick,
  onKeyDown,
  ariaLabel,
}: SeatShapeProps): JSX.Element | null {
  const { seat, x, y, rotation, studentName, locked, violating } = presentation;
  if (!seat.enabled) return null;
  if (!studentName && !options.showEmptySeats) return null;

  const isTrapezoid = seat.deskShape === 'trapezoid';
  const halfWidth = SEAT_WIDTH / 2;
  // Trapezoid desks keep their square footprint; a plain desk is a real
  // rectangle — twice as wide (side-to-side) as it is deep (front-to-back).
  const halfHeight = isTrapezoid ? SEAT_SIZE / 2 : SEAT_DEPTH / 2;
  const textRotation = isTrapezoid ? 0 : quarterTurn(rotation);
  const label = studentName ? displayName(studentName, options.nameStyle) : '';
  const nameSize =
    options.nameFontSize ??
    fitSeatNameSize(label, seat, NAME_BASE_FONT_SIZE * options.fontScale);
  const wrapped = wrapSeatNameAt(label, seat, nameSize);

  const lineHeight = wrapped.fontSize * NAME_LINE_RATIO;
  // Centred in the desk minus the chair strip, so the last line clears the
  // chair-back marker instead of sitting on it.
  const nameCentreY = y - CHAIR_STRIP / 2;
  const firstLineY =
    nameCentreY - ((wrapped.lines.length - 1) * lineHeight) / 2 + wrapped.fontSize * 0.35;

  const classes = [
    'seat-shape',
    selected ? 'selected' : '',
    violating ? 'violating' : '',
    dropTarget ? 'drop-target' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <g
      className={classes}
      onPointerDown={onPointerDown}
      onClick={onClick}
      onKeyDown={onKeyDown}
      tabIndex={interactive ? 0 : undefined}
      role={interactive ? 'button' : undefined}
      aria-label={ariaLabel}
      style={interactive ? undefined : { pointerEvents: 'none' }}
    >
      {isTrapezoid ? (
        // Narrow edge (top, unrotated) points toward the pod's shared center;
        // the wide edge is where the chair sits. `rotation` — the combined
        // center+seat rotation — turns that point in 90° steps to fan several
        // of these around one point (§ DeskShape).
        <g transform={rotation ? `rotate(${rotation} ${x} ${y})` : undefined}>
          <polygon
            className="seat-rect"
            points={trapezoidPoints(x, y, halfWidth)}
            fill={studentName ? 'var(--seat-fill)' : 'var(--seat-empty-fill)'}
            stroke="var(--seat-stroke)"
            strokeWidth={1.5}
          />
          <rect
            x={x - halfWidth + 8}
            y={y + halfHeight - 5}
            width={SEAT_WIDTH - 16}
            height={3}
            rx={1.5}
            fill="var(--seat-stroke)"
            opacity={0.7}
          />
        </g>
      ) : (
        // `rotation` is combined center+seat rotation; a plain desk is not
        // square anymore, so it needs the same rotate-around-centre treatment
        // as the trapezoid for its facing direction to show correctly.
        <g transform={rotation ? `rotate(${rotation} ${x} ${y})` : undefined}>
          <rect
            className="seat-rect"
            x={x - halfWidth}
            y={y - halfHeight}
            width={SEAT_WIDTH}
            height={SEAT_DEPTH}
            rx={SEAT_CORNER}
            fill={studentName ? 'var(--seat-fill)' : 'var(--seat-empty-fill)'}
            stroke="var(--seat-stroke)"
            strokeWidth={1.5}
          />
          {/* Chair-back marker: shows which way the seat faces without needing colour. */}
          <rect
            x={x - halfWidth + 10}
            y={y + halfHeight - 5}
            width={SEAT_WIDTH - 20}
            height={3}
            rx={1.5}
            fill="var(--seat-stroke)"
            opacity={0.7}
          />
        </g>
      )}
      {/*
        A quarter-turned desk is drawn depth-across, so its name is laid out in
        the desk's own frame and turned with it — otherwise the text would be
        fitted to a 130-wide box and drawn into a 70-wide one. Never turned a
        half turn: upside-down names are worse than sideways ones.
      */}
      <g transform={textRotation ? `rotate(${textRotation} ${x} ${y})` : undefined}>
        {locked ? (
          <text x={x + halfWidth - 9} y={y - halfHeight + 13} fontSize={10} fill="var(--text-muted)">
            ✱
          </text>
        ) : null}
        {violating ? (
          <text x={x - halfWidth + 4} y={y - halfHeight + 13} fontSize={11} fill="var(--danger)">
            !
          </text>
        ) : null}
        {wrapped.lines.length > 0 ? (
          <text
            className="seat-name"
            x={x}
            textAnchor="middle"
            fontSize={wrapped.fontSize}
            fill="var(--text)"
          >
            {wrapped.lines.map((line, index) => (
              <tspan key={line + String(index)} x={x} y={firstLineY + index * lineHeight}>
                {line}
              </tspan>
            ))}
          </text>
        ) : options.showSeatLabels && seat.label ? (
          <text
            className="seat-name"
            x={x}
            y={y + 4}
            textAnchor="middle"
            fontSize={9}
            fill="var(--text-muted)"
          >
            {seat.label}
          </text>
        ) : null}
      </g>
    </g>
  );
}

export function TextLabelShape({ label }: { label: TextLabel }): JSX.Element {
  return (
    <text
      className="seat-name"
      x={label.x}
      y={label.y}
      fontSize={label.fontSize}
      fill="var(--text)"
      transform={label.rotation ? `rotate(${label.rotation} ${label.x} ${label.y})` : undefined}
    >
      {label.text}
    </text>
  );
}

// ---------------------------------------------------------------------------
// Composite
// ---------------------------------------------------------------------------

export interface RoomLayerProps {
  room: RoomDefinition;
  seats: SeatPresentation[];
  options: RoomViewOptions;
}

/** Static drawing of the room, used by exports and previews. */
export function RoomLayer({ room, seats, options }: RoomLayerProps): JSX.Element {
  return (
    <g>
      {options.showRegions
        ? room.regions
            .filter((region) => region.visibleInExport || region.visibleInEditor)
            .map((region) => <RegionShape key={region.id} region={region} />)
        : null}

      {options.showObjects
        ? room.objects
            .filter((object) => object.visibleInExport)
            .map((object) => <ObjectShape key={object.id} object={object} />)
        : null}

      {options.showCenterOutlines
        ? room.centers.map((center) => (
            <CenterOutline
              key={center.id}
              center={center}
              label={options.showCenterLabels ? centerDisplayName(center) : undefined}
            />
          ))
        : null}

      {options.showSeats
        ? seats.map((presentation) => (
            <Fragment key={presentation.seat.id}>
              <SeatShape presentation={presentation} options={options} />
            </Fragment>
          ))
        : null}

      {room.labels
        .filter((label) => label.visibleInExport)
        .map((label) => (
          <TextLabelShape key={label.id} label={label} />
        ))}
    </g>
  );
}
