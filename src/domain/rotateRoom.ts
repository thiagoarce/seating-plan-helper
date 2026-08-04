/**
 * Quarter-turning a whole room (PRODUCT_SPEC §5.2).
 *
 * A classroom that is deeper than it is wide — or one whose board is on a side
 * wall — is the same arrangement seen from a different corner, not a different
 * arrangement. Rotating is therefore a pure re-mapping of coordinates: nothing
 * is added, removed, or resized, and turning four times returns the original.
 */

import { rectCenter } from './geometry';
import type {
  Point,
  Region,
  RoomDefinition,
  RoomObject,
  Rotation,
  SeatingCenter,
  TextLabel,
} from './types';

export type TurnDirection = 'clockwise' | 'counterclockwise';

/**
 * Maps a point into the turned room.
 *
 * Screen coordinates grow downward, so a clockwise turn sends the old top-left
 * corner to the new top-right. The room's own width and height swap, which is
 * why the old `height` is the horizontal extent afterwards.
 */
function turnPoint(point: Point, room: RoomDefinition, direction: TurnDirection): Point {
  return direction === 'clockwise'
    ? { x: room.height - point.y, y: point.x }
    : { x: point.y, y: room.width - point.x };
}

function turnRotation(rotation: Rotation, direction: TurnDirection): Rotation {
  const delta = direction === 'clockwise' ? 90 : 270;
  return (((rotation + delta) % 360) as Rotation);
}

/**
 * Turns a box by its midpoint, which is the one point its own rotation leaves
 * alone. Intrinsic width and height are kept as they are and the extra quarter
 * turn is folded into the box's own `rotation`, so a group's seat offsets —
 * stored in its unrotated local space — never have to be rewritten.
 */
function turnBox<T extends { x: number; y: number; width: number; height: number; rotation: Rotation }>(
  box: T,
  room: RoomDefinition,
  direction: TurnDirection,
): T {
  const midpoint = turnPoint(rectCenter(box), room, direction);
  return {
    ...box,
    x: midpoint.x - box.width / 2,
    y: midpoint.y - box.height / 2,
    rotation: turnRotation(box.rotation, direction),
  };
}

function turnRegion(region: Region, room: RoomDefinition, direction: TurnDirection): Region {
  if (region.geometry.type === 'polygon') {
    return {
      ...region,
      geometry: {
        type: 'polygon',
        points: region.geometry.points.map((point) => turnPoint(point, room, direction)),
      },
    };
  }

  // A rectangle region has no rotation of its own, so the turned box has to be
  // rebuilt from two opposite corners rather than by swapping a rotation field.
  const { x, y, width, height } = region.geometry;
  const a = turnPoint({ x, y }, room, direction);
  const b = turnPoint({ x: x + width, y: y + height }, room, direction);
  return {
    ...region,
    geometry: {
      type: 'rectangle',
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(b.x - a.x),
      height: Math.abs(b.y - a.y),
    },
  };
}

function turnLabel(label: TextLabel, room: RoomDefinition, direction: TurnDirection): TextLabel {
  const turned = turnPoint({ x: label.x, y: label.y }, room, direction);
  return {
    ...label,
    x: turned.x,
    y: turned.y,
    rotation: turnRotation(label.rotation, direction),
  };
}

/** A quarter-turned copy of `room`. The original is left untouched. */
export function rotateRoom(room: RoomDefinition, direction: TurnDirection): RoomDefinition {
  const width = room.height;
  const height = room.width;

  return {
    ...room,
    width,
    height,
    orientation: width >= height ? 'landscape' : 'portrait',
    centers: room.centers.map(
      (center): SeatingCenter => turnBox(center, room, direction),
    ),
    objects: room.objects.map((object): RoomObject => turnBox(object, room, direction)),
    regions: room.regions.map((region) => turnRegion(region, room, direction)),
    labels: room.labels.map((label) => turnLabel(label, room, direction)),
  };
}
