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
import { SEAT_SIZE } from '../domain/defaults';
import { rotatedBounds, seatWorldPosition } from '../domain/geometry';
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

export interface SeatPresentation {
  seat: Seat;
  center: SeatingCenter;
  x: number;
  y: number;
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
  emptySeatLabel?: string;
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
const NAME_BASE_FONT_SIZE = 11;
const NAME_MIN_FONT_SIZE = 6;

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
      <text
        className="seat-name"
        x={bounds.x + bounds.width / 2}
        y={bounds.y + bounds.height / 2 + 4}
        textAnchor="middle"
        fontSize={12}
        fill="var(--text-muted)"
      >
        {object.name}
      </text>
    </g>
  );
}

export function CenterOutline({
  center,
  selected,
  onPointerDown,
}: {
  center: SeatingCenter;
  selected?: boolean;
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
  const { seat, x, y, studentName, locked, violating } = presentation;
  if (!seat.enabled) return null;
  if (!studentName && !options.showEmptySeats) return null;

  const half = SEAT_SIZE / 2;
  const label = studentName ? displayName(studentName, options.nameStyle) : '';
  const wrapped = wrapName(label, {
    maxWidth: SEAT_SIZE - 8,
    maxLines: 3,
    fontSize: NAME_BASE_FONT_SIZE * options.fontScale,
    minFontSize: NAME_MIN_FONT_SIZE,
  });

  const lineHeight = wrapped.fontSize * 1.15;
  const firstLineY = y - ((wrapped.lines.length - 1) * lineHeight) / 2 + wrapped.fontSize * 0.35;

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
      <rect
        className="seat-rect"
        x={x - half}
        y={y - half}
        width={SEAT_SIZE}
        height={SEAT_SIZE}
        rx={SEAT_CORNER}
        fill={studentName ? 'var(--seat-fill)' : 'var(--seat-empty-fill)'}
        stroke="var(--seat-stroke)"
        strokeWidth={1.5}
      />
      {/* Chair-back marker: shows which way the seat faces without needing colour. */}
      <rect
        x={x - half + 10}
        y={y + half - 5}
        width={SEAT_SIZE - 20}
        height={3}
        rx={1.5}
        fill="var(--seat-stroke)"
        opacity={0.7}
      />
      {locked ? (
        <text x={x + half - 9} y={y - half + 13} fontSize={10} fill="var(--text-muted)">
          ✱
        </text>
      ) : null}
      {violating ? (
        <text x={x - half + 4} y={y - half + 13} fontSize={11} fill="var(--danger)">
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
      ) : options.emptySeatLabel ? (
        <text
          className="seat-name"
          x={x}
          y={y + 4}
          textAnchor="middle"
          fontSize={9}
          fill="var(--text-muted)"
        >
          {options.emptySeatLabel}
        </text>
      ) : null}
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
        ? room.centers.map((center) => <CenterOutline key={center.id} center={center} />)
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
