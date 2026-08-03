/**
 * Spatial semantics (TECHNICAL_SPEC §6).
 *
 * All functions operate on logical room units and are pure.
 */

import type {
  Point,
  Rect,
  Region,
  RegionGeometry,
  RoomObject,
  Rotation,
  Seat,
  SeatingCenter,
} from './types';

/** Midpoint of an axis-aligned rectangle. */
export function rectCenter(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/**
 * Rotates `point` around `origin` by a quarter-turn multiple.
 *
 * Screen coordinates grow downward, so a positive rotation is clockwise.
 */
export function rotatePoint(point: Point, origin: Point, rotation: Rotation): Point {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  switch (rotation) {
    case 0:
      return { x: point.x, y: point.y };
    case 90:
      return { x: origin.x - dy, y: origin.y + dx };
    case 180:
      return { x: origin.x - dx, y: origin.y - dy };
    case 270:
      return { x: origin.x + dy, y: origin.y - dx };
  }
}

/**
 * Axis-aligned bounding box of a rectangle after rotation about its own
 * midpoint. Quarter-turns keep the box axis-aligned, so 90/270 simply swap
 * width and height around the same midpoint.
 */
export function rotatedBounds(rect: Rect, rotation: Rotation): Rect {
  if (rotation === 0 || rotation === 180) {
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }
  const mid = rectCenter(rect);
  return {
    x: mid.x - rect.height / 2,
    y: mid.y - rect.width / 2,
    width: rect.height,
    height: rect.width,
  };
}

/**
 * World position of a seat, derived from its offset inside the center and the
 * center's transform (TECHNICAL_SPEC §6.1).
 *
 * Seat offsets are stored in the center's unrotated local space, so moving,
 * resizing, or rotating a center never rewrites its seats.
 */
export function seatWorldPosition(center: SeatingCenter, seat: Seat): Point {
  const mid = rectCenter(center);
  const unrotated: Point = { x: center.x + seat.x, y: center.y + seat.y };
  return rotatePoint(unrotated, mid, center.rotation);
}

/** Combined world rotation of a seat, in degrees — purely a rendering angle. */
export function seatWorldRotation(center: SeatingCenter, seat: Seat): number {
  return (center.rotation + seat.rotation) % 360;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Shortest distance from a point to an axis-aligned rectangle (0 if inside). */
export function distancePointToRect(point: Point, rect: Rect): number {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

/**
 * Distance from a seat to a room object, measured to the nearest point of the
 * object's bounding box (TECHNICAL_SPEC §6.3).
 */
export function distanceToObject(seatPosition: Point, object: RoomObject): number {
  const bounds = rotatedBounds(object, object.rotation);
  return distancePointToRect(seatPosition, bounds);
}

/** Gap between two rectangles; 0 when they touch or overlap. */
export function rectGap(a: Rect, b: Rect): number {
  const dx = Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width), 0);
  const dy = Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height), 0);
  return Math.hypot(dx, dy);
}

export function pointInRect(point: Point, rect: Rect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

/** Even-odd ray casting. Points exactly on an edge may fall either way. */
export function pointInPolygon(point: Point, points: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i];
    const b = points[j];
    if (!a || !b) continue;
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function pointInGeometry(point: Point, geometry: RegionGeometry): boolean {
  return geometry.type === 'rectangle'
    ? pointInRect(point, geometry)
    : pointInPolygon(point, geometry.points);
}

/**
 * A seat belongs to a region when its world position lies inside the region
 * geometry (TECHNICAL_SPEC §6.2). Regions may overlap, so a seat can belong to
 * several.
 */
export function seatInRegion(seatPosition: Point, region: Region): boolean {
  return pointInGeometry(seatPosition, region.geometry);
}

export function regionsForSeat(seatPosition: Point, regions: readonly Region[]): string[] {
  return regions.filter((region) => seatInRegion(seatPosition, region)).map((region) => region.id);
}

/**
 * Two centers are adjacent when they are distinct and their bounding boxes lie
 * within `threshold` of each other (TECHNICAL_SPEC §6.3).
 */
export function centersAdjacent(
  a: SeatingCenter,
  b: SeatingCenter,
  threshold: number,
): boolean {
  if (a.id === b.id) return false;
  return rectGap(rotatedBounds(a, a.rotation), rotatedBounds(b, b.rotation)) <= threshold;
}

/** Bounding box that contains every supplied rectangle, or null when empty. */
export function unionBounds(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const rect of rects) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
