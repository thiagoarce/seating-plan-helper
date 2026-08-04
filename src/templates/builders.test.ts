import { describe, expect, it } from 'vitest';
import { rectCenter, rotatePoint, seatWorldPosition } from '../domain/geometry';
import type { Point, Rotation } from '../domain/types';
import { SEAT_DEPTH, SEAT_WIDTH } from '../domain/defaults';
import {
  buildClosedIsland,
  buildTrapezoidDesk,
  buildTrapezoidFlower,
  buildTrapezoidHexagon,
  buildTrapezoidRow,
  closedIslandFootprint,
} from './builders';

/** Rotates by an arbitrary degree, unlike `rotatePoint` which only handles quarter turns. */
function rotateByDegrees(point: Point, origin: Point, degrees: number): Point {
  const radians = (degrees * Math.PI) / 180;
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  return {
    x: origin.x + dx * Math.cos(radians) - dy * Math.sin(radians),
    y: origin.y + dx * Math.sin(radians) + dy * Math.cos(radians),
  };
}

describe('buildTrapezoidFlower', () => {
  const pod = buildTrapezoidFlower({ id: 'f1', x: 100, y: 200, name: 'Flor 1' });

  it('produces four trapezoid seats', () => {
    expect(pod.seats).toHaveLength(4);
    expect(pod.seats.every((seat) => seat.deskShape === 'trapezoid')).toBe(true);
  });

  it('numbers seats locally within the pod', () => {
    expect(pod.seats.map((seat) => seat.label)).toEqual(['1', '2', '3', '4']);
  });

  it('keeps the pod itself unrotated, all rotation living on the seats', () => {
    expect(pod.rotation).toBe(0);
  });

  it('places every seat inside the pod footprint', () => {
    for (const seat of pod.seats) {
      expect(seat.x).toBeGreaterThanOrEqual(0);
      expect(seat.y).toBeGreaterThanOrEqual(0);
      expect(seat.x).toBeLessThanOrEqual(pod.width);
      expect(seat.y).toBeLessThanOrEqual(pod.height);
    }
  });

  it("orients each seat's narrow (inner) edge toward the shared pod center", () => {
    // The unrotated trapezoid's narrow edge sits at local y - half (north).
    // Rotating that point by the seat's own rotation must land it closer to
    // the pod's shared center than the seat's own position — i.e. the narrow
    // edge genuinely points inward, not outward or sideways.
    const podCenter = rectCenter({ x: 0, y: 0, width: pod.width, height: pod.height });
    const half = 30; // SEAT_SIZE / 2, mirrored from templates/builders.ts

    for (const seat of pod.seats) {
      const seatCenter = { x: seat.x, y: seat.y };
      const unrotatedNarrowEdge = { x: seat.x, y: seat.y - half };
      // buildTrapezoidFlower only ever produces quarter-turn rotations.
      const narrowEdge = rotatePoint(unrotatedNarrowEdge, seatCenter, seat.rotation as Rotation);

      const distanceBefore = Math.hypot(seatCenter.x - podCenter.x, seatCenter.y - podCenter.y);
      const distanceAfter = Math.hypot(narrowEdge.x - podCenter.x, narrowEdge.y - podCenter.y);

      expect(distanceAfter).toBeLessThan(distanceBefore);
    }
  });

  it('spaces the four seats evenly around the shared center', () => {
    const podCenter = rectCenter({ x: 0, y: 0, width: pod.width, height: pod.height });
    const distances = pod.seats.map((seat) => Math.hypot(seat.x - podCenter.x, seat.y - podCenter.y));
    const [first, ...rest] = distances;
    for (const distance of rest) {
      expect(distance).toBeCloseTo(first!, 5);
    }
  });

  it('keeps seat offsets stable when the pod moves, via seatWorldPosition', () => {
    const moved = buildTrapezoidFlower({ id: 'f1', x: 500, y: 500 });
    for (let i = 0; i < pod.seats.length; i += 1) {
      const original = seatWorldPosition(pod, pod.seats[i]!);
      const shifted = seatWorldPosition(moved, moved.seats[i]!);
      expect(shifted.x - original.x).toBe(400);
      expect(shifted.y - original.y).toBe(300);
    }
  });

  it('carries the given name and a fresh id-scoped seat prefix', () => {
    expect(pod.name).toBe('Flor 1');
    expect(pod.seats.every((seat) => seat.id.startsWith('f1-s'))).toBe(true);
    expect(pod.seats.every((seat) => seat.centerId === 'f1')).toBe(true);
  });
});

describe('buildTrapezoidDesk', () => {
  it('produces a single, unrotated trapezoid seat centered in a square footprint', () => {
    const desk = buildTrapezoidDesk({ id: 'd1', x: 10, y: 20, name: 'Trapézio 1' });
    expect(desk.seats).toHaveLength(1);
    expect(desk.seats[0]).toMatchObject({ rotation: 0, deskShape: 'trapezoid', enabled: true });
    expect(desk.width).toBe(desk.height);
    expect(desk.name).toBe('Trapézio 1');
  });
});

describe('buildTrapezoidHexagon', () => {
  const pod = buildTrapezoidHexagon({ id: 'h1', x: 0, y: 0, name: 'Hexágono 1' });

  it('produces six trapezoid seats, all inside the footprint', () => {
    expect(pod.seats).toHaveLength(6);
    expect(pod.seats.every((seat) => seat.deskShape === 'trapezoid')).toBe(true);
    for (const seat of pod.seats) {
      expect(seat.x).toBeGreaterThanOrEqual(0);
      expect(seat.y).toBeGreaterThanOrEqual(0);
      expect(seat.x).toBeLessThanOrEqual(pod.width);
      expect(seat.y).toBeLessThanOrEqual(pod.height);
    }
  });

  it('spaces the six seats at true 60° steps around the shared center', () => {
    const podCenter = rectCenter({ x: 0, y: 0, width: pod.width, height: pod.height });
    const distances = pod.seats.map((seat) => Math.hypot(seat.x - podCenter.x, seat.y - podCenter.y));
    const [first, ...rest] = distances;
    for (const distance of rest) expect(distance).toBeCloseTo(first!, 5);
    expect(new Set(pod.seats.map((seat) => seat.rotation)).size).toBe(6);
  });

  it("orients each seat's narrow edge toward the shared pod center", () => {
    const podCenter = rectCenter({ x: 0, y: 0, width: pod.width, height: pod.height });
    const half = 30;
    for (const seat of pod.seats) {
      const seatCenter = { x: seat.x, y: seat.y };
      const unrotatedNarrowEdge = { x: seat.x, y: seat.y - half };
      const narrowEdge = rotateByDegrees(unrotatedNarrowEdge, seatCenter, seat.rotation);
      const distanceBefore = Math.hypot(seatCenter.x - podCenter.x, seatCenter.y - podCenter.y);
      const distanceAfter = Math.hypot(narrowEdge.x - podCenter.x, narrowEdge.y - podCenter.y);
      expect(distanceAfter).toBeLessThan(distanceBefore);
    }
  });
});

describe('buildTrapezoidRow', () => {
  it.each([4, 5, 6])('lays out %i desks alternating 0°/180° rotation', (count) => {
    const row = buildTrapezoidRow({ id: 'r1', x: 0, y: 0, count });
    expect(row.seats).toHaveLength(count);
    expect(row.seats.map((seat) => seat.rotation)).toEqual(
      Array.from({ length: count }, (_, i) => (i % 2 === 0 ? 0 : 180)),
    );
  });

  it('spaces desks by an equal horizontal pitch, all at the same y', () => {
    const row = buildTrapezoidRow({ id: 'r1', x: 0, y: 0, count: 5 });
    const [first, ...rest] = row.seats;
    for (const seat of rest) expect(seat.y).toBe(first!.y);
    const gaps = row.seats.slice(1).map((seat, i) => seat.x - row.seats[i]!.x);
    for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0]!, 6);
  });

  it('grows the footprint width with more desks', () => {
    const short = buildTrapezoidRow({ id: 'r1', x: 0, y: 0, count: 4 });
    const long = buildTrapezoidRow({ id: 'r1', x: 0, y: 0, count: 6 });
    expect(long.width).toBeGreaterThan(short.width);
    expect(long.height).toBe(short.height);
  });
});

describe('buildClosedIsland', () => {
  const island = buildClosedIsland({ id: 'i1', x: 100, y: 200, name: 'Grupo 1' });
  const [a, b, c, d, head] = island.seats;

  it('seats five, with only the fifth turned across the end', () => {
    expect(island.seats).toHaveLength(5);
    expect([a, b, c, d].map((seat) => seat!.rotation)).toEqual([180, 180, 0, 0]);
    expect(head!.rotation).toBe(270);
  });

  it('arranges the first four as a 2x2 block', () => {
    expect(a!.y).toBe(b!.y);
    expect(c!.y).toBe(d!.y);
    expect(a!.x).toBe(c!.x);
    expect(b!.x).toBe(d!.x);
    expect(c!.y).toBeGreaterThan(a!.y);
    expect(b!.x).toBeGreaterThan(a!.x);
  });

  it('puts the head desk past the block, centred on it', () => {
    expect(head!.x).toBeGreaterThan(b!.x);
    expect(head!.y).toBeCloseTo((a!.y + c!.y) / 2, 6);
  });

  it('closes the rectangle: the turned desk spans the block it caps', () => {
    // Quarter-turned, the head desk is drawn SEAT_WIDTH tall — enough to reach
    // across both rows rather than leaving the end open.
    const blockTop = a!.y - SEAT_DEPTH / 2;
    const blockBottom = c!.y + SEAT_DEPTH / 2;
    const headTop = head!.y - SEAT_WIDTH / 2;
    const headBottom = head!.y + SEAT_WIDTH / 2;

    expect(headBottom - headTop).toBeGreaterThan((blockBottom - blockTop) * 0.8);
  });

  it('keeps every seat inside the reported footprint', () => {
    expect(island.width).toBe(closedIslandFootprint().width);
    expect(island.height).toBe(closedIslandFootprint().height);
    for (const seat of island.seats) {
      expect(seat.x).toBeGreaterThan(0);
      expect(seat.y).toBeGreaterThan(0);
      expect(seat.x).toBeLessThan(island.width);
      expect(seat.y).toBeLessThan(island.height);
    }
  });

  it('is wider than it is tall, unlike a plain group of five', () => {
    expect(island.width).toBeGreaterThan(island.height);
  });

  it('gives seats unique, locally numbered ids', () => {
    expect(new Set(island.seats.map((seat) => seat.id)).size).toBe(5);
    expect(island.seats.map((seat) => seat.label)).toEqual(['1', '2', '3', '4', '5']);
  });
});
