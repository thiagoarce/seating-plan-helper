import { describe, expect, it } from 'vitest';
import {
  centersAdjacent,
  distancePointToRect,
  distanceToObject,
  pointInPolygon,
  rectGap,
  rotatePoint,
  rotatedBounds,
  seatInRegion,
  seatWorldPosition,
  seatWorldRotation,
  unionBounds,
} from './geometry';
import type { Region, RoomObject, Seat, SeatingCenter } from './types';

function makeCenter(overrides: Partial<SeatingCenter> = {}): SeatingCenter {
  return {
    id: 'c1',
    x: 100,
    y: 100,
    width: 80,
    height: 40,
    rotation: 0,
    seats: [],
    ...overrides,
  };
}

function makeSeat(overrides: Partial<Seat> = {}): Seat {
  return { id: 's1', centerId: 'c1', x: 0, y: 0, rotation: 0, enabled: true, ...overrides };
}

describe('rotatePoint', () => {
  it('returns the point unchanged at 0 degrees', () => {
    expect(rotatePoint({ x: 5, y: 7 }, { x: 0, y: 0 }, 0)).toEqual({ x: 5, y: 7 });
  });

  it('rotates clockwise in screen coordinates', () => {
    expect(rotatePoint({ x: 10, y: 0 }, { x: 0, y: 0 }, 90)).toEqual({ x: 0, y: 10 });
    expect(rotatePoint({ x: 10, y: 0 }, { x: 0, y: 0 }, 180)).toEqual({ x: -10, y: 0 });
    expect(rotatePoint({ x: 10, y: 0 }, { x: 0, y: 0 }, 270)).toEqual({ x: 0, y: -10 });
  });

  it('four quarter turns return to the origin point', () => {
    const start = { x: 3, y: -4 };
    const origin = { x: 1, y: 1 };
    let p = start;
    for (let i = 0; i < 4; i += 1) p = rotatePoint(p, origin, 90);
    expect(p.x).toBeCloseTo(start.x);
    expect(p.y).toBeCloseTo(start.y);
  });
});

describe('rotatedBounds', () => {
  it('keeps the box for 0 and 180', () => {
    const rect = { x: 0, y: 0, width: 40, height: 10 };
    expect(rotatedBounds(rect, 0)).toEqual(rect);
    expect(rotatedBounds(rect, 180)).toEqual(rect);
  });

  it('swaps width and height around the same midpoint for 90 and 270', () => {
    const rect = { x: 0, y: 0, width: 40, height: 10 };
    expect(rotatedBounds(rect, 90)).toEqual({ x: 15, y: -15, width: 10, height: 40 });
    expect(rotatedBounds(rect, 270)).toEqual({ x: 15, y: -15, width: 10, height: 40 });
  });
});

describe('seatWorldPosition', () => {
  it('adds the seat offset to the center origin when unrotated', () => {
    const center = makeCenter();
    const seat = makeSeat({ x: 10, y: 5 });
    expect(seatWorldPosition(center, seat)).toEqual({ x: 110, y: 105 });
  });

  it('rotates the seat offset about the center midpoint', () => {
    const center = makeCenter({ x: 0, y: 0, width: 80, height: 40, rotation: 90 });
    // Midpoint (40, 20); seat at (0, 0) -> offset (-40, -20) -> rotated (20, -40).
    const seat = makeSeat({ x: 0, y: 0 });
    expect(seatWorldPosition(center, seat)).toEqual({ x: 60, y: -20 });
  });

  it('keeps seat offsets stable when the center moves', () => {
    const seat = makeSeat({ x: 12, y: 8 });
    const before = seatWorldPosition(makeCenter({ x: 0, y: 0 }), seat);
    const after = seatWorldPosition(makeCenter({ x: 50, y: 30 }), seat);
    expect(after.x - before.x).toBe(50);
    expect(after.y - before.y).toBe(30);
  });
});

describe('seatWorldRotation', () => {
  it('composes center and seat rotation modulo 360', () => {
    expect(seatWorldRotation(makeCenter({ rotation: 270 }), makeSeat({ rotation: 180 }))).toBe(90);
  });
});

describe('distancePointToRect', () => {
  const rect = { x: 0, y: 0, width: 10, height: 10 };

  it('is zero inside the rectangle', () => {
    expect(distancePointToRect({ x: 5, y: 5 }, rect)).toBe(0);
  });

  it('measures to the nearest edge', () => {
    expect(distancePointToRect({ x: 15, y: 5 }, rect)).toBe(5);
  });

  it('measures to the nearest corner diagonally', () => {
    expect(distancePointToRect({ x: 13, y: 14 }, rect)).toBeCloseTo(5);
  });
});

describe('distanceToObject', () => {
  it('uses the rotated bounding box of the object', () => {
    const object: RoomObject = {
      id: 'o1',
      type: 'board',
      name: 'Lousa',
      x: 0,
      y: 0,
      width: 40,
      height: 10,
      rotation: 90,
      shape: 'rectangle',
      visibleInExport: true,
    };
    // Rotated bounds are x:15 y:-15 w:10 h:40, so a point at x=30 is 5 away.
    expect(distanceToObject({ x: 30, y: 0 }, object)).toBe(5);
  });
});

describe('rectGap', () => {
  it('is zero for overlapping rectangles', () => {
    expect(
      rectGap({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 }),
    ).toBe(0);
  });

  it('measures the horizontal gap', () => {
    expect(
      rectGap({ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 0, width: 10, height: 10 }),
    ).toBe(10);
  });
});

describe('centersAdjacent', () => {
  it('never reports a center as adjacent to itself', () => {
    const center = makeCenter();
    expect(centersAdjacent(center, center, 1000)).toBe(false);
  });

  it('respects the threshold', () => {
    const a = makeCenter({ id: 'a', x: 0, y: 0 });
    const b = makeCenter({ id: 'b', x: 100, y: 0 });
    expect(centersAdjacent(a, b, 30)).toBe(true); // gap is 20
    expect(centersAdjacent(a, b, 10)).toBe(false);
  });
});

describe('pointInPolygon', () => {
  const triangle = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 0, y: 10 },
  ];

  it('detects points inside', () => {
    expect(pointInPolygon({ x: 2, y: 2 }, triangle)).toBe(true);
  });

  it('detects points outside', () => {
    expect(pointInPolygon({ x: 9, y: 9 }, triangle)).toBe(false);
  });
});

describe('seatInRegion', () => {
  const region: Region = {
    id: 'r1',
    name: 'Frente',
    geometry: { type: 'rectangle', x: 0, y: 0, width: 100, height: 50 },
    visibleInEditor: true,
    visibleInExport: false,
  };

  it('includes a seat whose world position is inside', () => {
    expect(seatInRegion({ x: 10, y: 10 }, region)).toBe(true);
  });

  it('excludes a seat outside', () => {
    expect(seatInRegion({ x: 10, y: 80 }, region)).toBe(false);
  });
});

describe('unionBounds', () => {
  it('returns null for an empty list', () => {
    expect(unionBounds([])).toBeNull();
  });

  it('covers every rectangle', () => {
    expect(
      unionBounds([
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 20, y: 5, width: 10, height: 30 },
      ]),
    ).toEqual({ x: 0, y: 0, width: 30, height: 35 });
  });
});
