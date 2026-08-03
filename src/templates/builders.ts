/**
 * Helpers for composing rooms out of seat groups.
 *
 * Seat offsets are stored in the center's own unrotated space, so a group can
 * be moved or rotated later without rewriting its seats (TECHNICAL_SPEC §8).
 */

import { SEAT_SIZE } from '../domain/defaults';
import type {
  Region,
  RegionGeometry,
  RoomObject,
  RoomObjectType,
  Rotation,
  Seat,
  SeatingCenter,
} from '../domain/types';

export const SEAT_GAP = 12;
export const CENTER_PADDING = 10;

export interface CenterSpec {
  id: string;
  x: number;
  y: number;
  seatCount: number;
  /** Seats per row inside the group. Defaults to a squarish arrangement. */
  columns?: number;
  name?: string;
  rotation?: Rotation;
  seatIdPrefix?: string;
}

export function centerFootprint(seatCount: number, columns: number): {
  width: number;
  height: number;
  rows: number;
} {
  const rows = Math.ceil(seatCount / columns);
  return {
    width: columns * SEAT_SIZE + (columns - 1) * SEAT_GAP + CENTER_PADDING * 2,
    height: rows * SEAT_SIZE + (rows - 1) * SEAT_GAP + CENTER_PADDING * 2,
    rows,
  };
}

export function buildCenter(spec: CenterSpec): SeatingCenter {
  const columns = spec.columns ?? (spec.seatCount <= 2 ? spec.seatCount : Math.ceil(spec.seatCount / 2));
  const { width, height } = centerFootprint(spec.seatCount, Math.max(columns, 1));
  const prefix = spec.seatIdPrefix ?? spec.id;

  const seats: Seat[] = Array.from({ length: spec.seatCount }, (_, position) => {
    const column = position % columns;
    const row = Math.floor(position / columns);
    return {
      id: `${prefix}-s${position + 1}`,
      centerId: spec.id,
      // Offsets point at the seat's centre, which is what region membership and
      // all distance measures use.
      x: CENTER_PADDING + column * (SEAT_SIZE + SEAT_GAP) + SEAT_SIZE / 2,
      y: CENTER_PADDING + row * (SEAT_SIZE + SEAT_GAP) + SEAT_SIZE / 2,
      rotation: 0,
      enabled: true,
    };
  });

  return {
    id: spec.id,
    ...(spec.name !== undefined ? { name: spec.name } : {}),
    x: spec.x,
    y: spec.y,
    width,
    height,
    rotation: spec.rotation ?? 0,
    seats,
  };
}

export interface GridSpec {
  columns: number;
  rows: number;
  seatsPerCenter: number;
  seatColumns?: number;
  originX: number;
  originY: number;
  gapX: number;
  gapY: number;
  idPrefix?: string;
}

/** Lays out a regular grid of identical seat groups. */
export function buildCenterGrid(spec: GridSpec): SeatingCenter[] {
  const prefix = spec.idPrefix ?? 'g';
  const columns = spec.seatColumns ?? Math.min(spec.seatsPerCenter, 2);
  const { width, height } = centerFootprint(spec.seatsPerCenter, columns);

  const centers: SeatingCenter[] = [];
  for (let row = 0; row < spec.rows; row += 1) {
    for (let column = 0; column < spec.columns; column += 1) {
      const index = row * spec.columns + column + 1;
      centers.push(
        buildCenter({
          id: `${prefix}${index}`,
          name: `${index}`,
          x: spec.originX + column * (width + spec.gapX),
          y: spec.originY + row * (height + spec.gapY),
          seatCount: spec.seatsPerCenter,
          columns,
        }),
      );
    }
  }
  return centers;
}

export function buildObject(
  id: string,
  type: RoomObjectType,
  name: string,
  rect: { x: number; y: number; width: number; height: number },
  options: { shape?: RoomObject['shape']; rotation?: Rotation } = {},
): RoomObject {
  return {
    id,
    type,
    name,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    rotation: options.rotation ?? 0,
    shape: options.shape ?? 'roundedRectangle',
    visibleInExport: true,
  };
}

export function buildRegion(
  id: string,
  name: string,
  geometry: RegionGeometry,
): Region {
  return { id, name, geometry, visibleInEditor: true, visibleInExport: false };
}

/**
 * Front/middle/back bands covering the whole room. Rules refer to these named
 * regions instead of assuming anything about rows (PRODUCT_SPEC §5.5).
 */
export function buildDepthBands(
  width: number,
  height: number,
  names: { front: string; middle: string; back: string },
): Region[] {
  const band = height / 3;
  return [
    buildRegion('region-front', names.front, {
      type: 'rectangle',
      x: 0,
      y: 0,
      width,
      height: band,
    }),
    buildRegion('region-middle', names.middle, {
      type: 'rectangle',
      x: 0,
      y: band,
      width,
      height: band,
    }),
    buildRegion('region-back', names.back, {
      type: 'rectangle',
      x: 0,
      y: band * 2,
      width,
      height: height - band * 2,
    }),
  ];
}
