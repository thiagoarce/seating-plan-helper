/**
 * Editor geometry helpers (TECHNICAL_SPEC §8).
 *
 * Kept separate from the React component so snapping and alignment — the parts
 * most likely to feel wrong — can be tested directly.
 */

import { rotatedBounds } from '../domain/geometry';
import type { Rect, RoomDefinition, Rotation } from '../domain/types';

export interface Guide {
  orientation: 'vertical' | 'horizontal';
  position: number;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: Guide[];
}

export function snapToGrid(value: number, gridSize: number): number {
  if (gridSize <= 0) return value;
  return Math.round(value / gridSize) * gridSize;
}

/** The three interesting x (or y) coordinates of a rectangle. */
function edgesX(rect: Rect): number[] {
  return [rect.x, rect.x + rect.width / 2, rect.x + rect.width];
}

function edgesY(rect: Rect): number[] {
  return [rect.y, rect.y + rect.height / 2, rect.y + rect.height];
}

export interface SnapOptions {
  gridSize: number;
  snapToGrid: boolean;
  /** Maximum distance, in room units, at which a guide takes hold. */
  threshold: number;
}

/**
 * Adjusts a proposed move so the dragged rectangle lines up with the grid or
 * with another item's edge or midline. Alignment wins over the grid when both
 * are in range, because a deliberate visual alignment matters more than the
 * grid it happens to sit on.
 */
export function computeSnap(
  moved: Rect,
  others: readonly Rect[],
  options: SnapOptions,
): SnapResult {
  const guides: Guide[] = [];
  let dx = 0;
  let dy = 0;

  let bestX = options.threshold + 1;
  let bestY = options.threshold + 1;

  for (const other of others) {
    for (const movedEdge of edgesX(moved)) {
      for (const otherEdge of edgesX(other)) {
        const distance = Math.abs(movedEdge - otherEdge);
        if (distance <= options.threshold && distance < bestX) {
          bestX = distance;
          dx = otherEdge - movedEdge;
        }
      }
    }
    for (const movedEdge of edgesY(moved)) {
      for (const otherEdge of edgesY(other)) {
        const distance = Math.abs(movedEdge - otherEdge);
        if (distance <= options.threshold && distance < bestY) {
          bestY = distance;
          dy = otherEdge - movedEdge;
        }
      }
    }
  }

  if (bestX <= options.threshold) {
    guides.push({ orientation: 'vertical', position: moved.x + dx });
  } else if (options.snapToGrid) {
    dx = snapToGrid(moved.x, options.gridSize) - moved.x;
  }

  if (bestY <= options.threshold) {
    guides.push({ orientation: 'horizontal', position: moved.y + dy });
  } else if (options.snapToGrid) {
    dy = snapToGrid(moved.y, options.gridSize) - moved.y;
  }

  return { dx, dy, guides };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return !(
    a.x + a.width < b.x ||
    b.x + b.width < a.x ||
    a.y + a.height < b.y ||
    b.y + b.height < a.y
  );
}

/** Normalizes a drag rectangle that may have been drawn in any direction. */
export function normalizeRect(start: { x: number; y: number }, end: { x: number; y: number }): Rect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

export function rotateBy90(rotation: Rotation, steps = 1): Rotation {
  const next = (((rotation + steps * 90) % 360) + 360) % 360;
  return next as Rotation;
}

export interface MovableItem {
  key: string;
  bounds: Rect;
}

/** Bounding boxes of everything in the room, for snapping and marquee tests. */
export function collectItemBounds(
  room: RoomDefinition,
  exclude: ReadonlySet<string> = new Set(),
): MovableItem[] {
  const items: MovableItem[] = [];

  for (const center of room.centers) {
    const key = `center:${center.id}`;
    if (!exclude.has(key)) items.push({ key, bounds: rotatedBounds(center, center.rotation) });
  }
  for (const object of room.objects) {
    const key = `object:${object.id}`;
    if (!exclude.has(key)) items.push({ key, bounds: rotatedBounds(object, object.rotation) });
  }
  for (const region of room.regions) {
    const key = `region:${region.id}`;
    if (exclude.has(key)) continue;
    if (region.geometry.type === 'rectangle') {
      items.push({ key, bounds: region.geometry });
    } else {
      const xs = region.geometry.points.map((point) => point.x);
      const ys = region.geometry.points.map((point) => point.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      items.push({
        key,
        bounds: { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY },
      });
    }
  }
  for (const label of room.labels) {
    const key = `label:${label.id}`;
    if (!exclude.has(key)) {
      items.push({
        key,
        bounds: {
          x: label.x,
          y: label.y - label.fontSize,
          width: Math.max(label.text.length * label.fontSize * 0.52, 20),
          height: label.fontSize * 1.3,
        },
      });
    }
  }

  return items;
}

/** Union of the selected items' bounds, used to place transform handles. */
export function selectionBounds(items: readonly MovableItem[]): Rect | null {
  if (items.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const item of items) {
    minX = Math.min(minX, item.bounds.x);
    minY = Math.min(minY, item.bounds.y);
    maxX = Math.max(maxX, item.bounds.x + item.bounds.width);
    maxY = Math.max(maxY, item.bounds.y + item.bounds.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const RESIZE_HANDLES: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export function handlePosition(bounds: Rect, handle: ResizeHandle): { x: number; y: number } {
  const left = bounds.x;
  const right = bounds.x + bounds.width;
  const top = bounds.y;
  const bottom = bounds.y + bounds.height;
  const midX = bounds.x + bounds.width / 2;
  const midY = bounds.y + bounds.height / 2;

  switch (handle) {
    case 'nw':
      return { x: left, y: top };
    case 'n':
      return { x: midX, y: top };
    case 'ne':
      return { x: right, y: top };
    case 'e':
      return { x: right, y: midY };
    case 'se':
      return { x: right, y: bottom };
    case 's':
      return { x: midX, y: bottom };
    case 'sw':
      return { x: left, y: bottom };
    case 'w':
      return { x: left, y: midY };
  }
}

export const MIN_ITEM_SIZE = 20;

/** Applies a handle drag, keeping the opposite edge fixed and size positive. */
export function resizeRect(
  bounds: Rect,
  handle: ResizeHandle,
  deltaX: number,
  deltaY: number,
): Rect {
  let { x, y, width, height } = bounds;

  if (handle.includes('w')) {
    const clamped = Math.min(deltaX, width - MIN_ITEM_SIZE);
    x += clamped;
    width -= clamped;
  }
  if (handle.includes('e')) {
    width = Math.max(MIN_ITEM_SIZE, width + deltaX);
  }
  if (handle.includes('n')) {
    const clamped = Math.min(deltaY, height - MIN_ITEM_SIZE);
    y += clamped;
    height -= clamped;
  }
  if (handle.includes('s')) {
    height = Math.max(MIN_ITEM_SIZE, height + deltaY);
  }

  return { x, y, width, height };
}

/**
 * Scales seat offsets when a center is resized, so the seats keep their
 * relative arrangement (TECHNICAL_SPEC §8 prefers proportional scaling).
 */
export function scaleSeatOffsets(
  seats: ReadonlyArray<{ x: number; y: number }>,
  from: { width: number; height: number },
  to: { width: number; height: number },
): Array<{ x: number; y: number }> {
  const scaleX = from.width === 0 ? 1 : to.width / from.width;
  const scaleY = from.height === 0 ? 1 : to.height / from.height;
  return seats.map((seat) => ({ x: seat.x * scaleX, y: seat.y * scaleY }));
}
