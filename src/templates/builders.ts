/**
 * Helpers for composing rooms out of seat groups.
 *
 * Seat offsets are stored in the center's own unrotated space, so a group can
 * be moved or rotated later without rewriting its seats (TECHNICAL_SPEC §8).
 */

import { SEAT_DEPTH, SEAT_SIZE, SEAT_WIDTH } from '../domain/defaults';
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
    width: columns * SEAT_WIDTH + (columns - 1) * SEAT_GAP + CENTER_PADDING * 2,
    height: rows * SEAT_DEPTH + (rows - 1) * SEAT_GAP + CENTER_PADDING * 2,
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
      x: CENTER_PADDING + column * (SEAT_WIDTH + SEAT_GAP) + SEAT_WIDTH / 2,
      y: CENTER_PADDING + row * (SEAT_DEPTH + SEAT_GAP) + SEAT_DEPTH / 2,
      rotation: 0,
      enabled: true,
      // A local, 1-based number identifies the seat within its group so the
      // fixed-seat rule picker and the roster's seat tag never have to fall
      // back to the raw seat id (shared/labels.ts combines this with the
      // center's own name, e.g. "Grupo 2 · 3").
      label: `${position + 1}`,
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
  /** Prefixes each center's default name, e.g. "Fileira 1", "Dupla 1". */
  namePrefix?: string;
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
          name: spec.namePrefix ? `${spec.namePrefix} ${index}` : `${index}`,
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

/** Distance from a flower pod's shared center to each trapezoid's midpoint. */
const FLOWER_RADIUS = SEAT_SIZE / 2 + 4;
const FLOWER_PADDING = 15;
/** Pod footprint: radius in every direction plus half a desk, plus padding. */
const FLOWER_BOX_SIZE = (FLOWER_RADIUS + SEAT_SIZE / 2) * 2 + FLOWER_PADDING * 2;

export interface FlowerPodSpec {
  id: string;
  x: number;
  y: number;
  name?: string;
}

/**
 * Four trapezoid desks fanned around a shared center — narrow edges pointing
 * inward, wide edges (where the chairs sit) facing outward — approximating
 * the hexagonal/starburst trapezoid pods real classroom furniture comes in.
 * A true 3-way (120°) or 6-way (60°) fan would need rotation finer than the
 * editor's 90° increments, so this is the closest four-way version that
 * still uses ordinary quarter turns (PRODUCT_SPEC §5.2).
 */
export function buildTrapezoidFlower(spec: FlowerPodSpec): SeatingCenter {
  const center = FLOWER_BOX_SIZE / 2;
  // Rotation is a compass bearing clockwise from north (0°): the unrotated
  // trapezoid's narrow edge points north, so a seat north of the shared
  // center needs its narrow edge turned to face south (180°), and so on
  // around the compass.
  const petals: Array<{ dx: number; dy: number; rotation: Rotation }> = [
    { dx: 0, dy: -FLOWER_RADIUS, rotation: 180 },
    { dx: FLOWER_RADIUS, dy: 0, rotation: 270 },
    { dx: 0, dy: FLOWER_RADIUS, rotation: 0 },
    { dx: -FLOWER_RADIUS, dy: 0, rotation: 90 },
  ];

  const seats: Seat[] = petals.map((petal, position) => ({
    id: `${spec.id}-s${position + 1}`,
    centerId: spec.id,
    x: center + petal.dx,
    y: center + petal.dy,
    rotation: petal.rotation,
    enabled: true,
    deskShape: 'trapezoid',
    label: `${position + 1}`,
  }));

  return {
    id: spec.id,
    ...(spec.name !== undefined ? { name: spec.name } : {}),
    x: spec.x,
    y: spec.y,
    width: FLOWER_BOX_SIZE,
    height: FLOWER_BOX_SIZE,
    rotation: 0,
    seats,
  };
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
