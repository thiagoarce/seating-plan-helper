import { describe, expect, it } from 'vitest';
import { createEmptyRoom } from './defaults';
import { rectCenter, seatWorldPosition } from './geometry';
import { roomDefinitionSchema } from './schema';
import { rotateRoom } from './rotateRoom';
import type { RoomDefinition } from './types';
import { buildCenter, buildObject, buildRegion } from '../templates/builders';

function furnishedRoom(): RoomDefinition {
  const room = createEmptyRoom();
  room.width = 1200;
  room.height = 800;
  room.centers = [
    buildCenter({ id: 'g1', x: 100, y: 200, seatCount: 4, columns: 2, name: 'Grupo 1' }),
    buildCenter({ id: 'g2', x: 700, y: 500, seatCount: 2, columns: 2, name: 'Grupo 2' }),
  ];
  room.objects = [
    buildObject('board', 'board', 'Lousa', { x: 400, y: 24, width: 400, height: 24 }),
    buildObject('door', 'door', 'Porta', { x: 1160, y: 300, width: 24, height: 100 }),
  ];
  room.regions = [
    buildRegion('front', 'Frente', { type: 'rectangle', x: 0, y: 0, width: 1200, height: 260 }),
    buildRegion('corner', 'Canto', {
      type: 'polygon',
      points: [
        { x: 0, y: 600 },
        { x: 200, y: 600 },
        { x: 200, y: 800 },
      ],
    }),
  ];
  room.labels = [
    { id: 'l1', text: 'Janelas', x: 60, y: 400, rotation: 0, fontSize: 14, visibleInExport: true },
  ];
  return room;
}

describe('rotateRoom', () => {
  it('swaps the room dimensions and re-derives the orientation', () => {
    const turned = rotateRoom(furnishedRoom(), 'clockwise');

    expect(turned.width).toBe(800);
    expect(turned.height).toBe(1200);
    expect(turned.orientation).toBe('portrait');
  });

  it('leaves the original room untouched', () => {
    const room = furnishedRoom();
    const before = structuredClone(room);
    rotateRoom(room, 'clockwise');

    expect(room).toEqual(before);
  });

  it('returns to the original after four quarter turns', () => {
    const room = furnishedRoom();
    let turned = room;
    for (let i = 0; i < 4; i += 1) turned = rotateRoom(turned, 'clockwise');

    expect(turned).toEqual(room);
  });

  it('is undone by a turn in the opposite direction', () => {
    const room = furnishedRoom();

    expect(rotateRoom(rotateRoom(room, 'clockwise'), 'counterclockwise')).toEqual(room);
  });

  it('sends the top-left corner to the top-right when turning clockwise', () => {
    const room = createEmptyRoom();
    room.width = 1200;
    room.height = 800;
    room.objects = [buildObject('o', 'custom', 'x', { x: 0, y: 0, width: 100, height: 60 })];

    const turned = rotateRoom(room, 'clockwise');
    const midpoint = rectCenter(turned.objects[0]!);

    // New room is 800 wide: a corner item ends up against its right edge.
    expect(midpoint.x).toBeGreaterThan(turned.width / 2);
    expect(midpoint.y).toBeLessThan(turned.height / 2);
  });

  it('keeps every item inside the turned room', () => {
    const turned = rotateRoom(furnishedRoom(), 'clockwise');

    for (const center of turned.centers) {
      const midpoint = rectCenter(center);
      expect(midpoint.x).toBeGreaterThanOrEqual(0);
      expect(midpoint.y).toBeGreaterThanOrEqual(0);
      expect(midpoint.x).toBeLessThanOrEqual(turned.width);
      expect(midpoint.y).toBeLessThanOrEqual(turned.height);
    }
  });

  it('adds a quarter turn to each item rather than resizing it', () => {
    const room = furnishedRoom();
    const turned = rotateRoom(room, 'clockwise');

    for (let i = 0; i < room.centers.length; i += 1) {
      expect(turned.centers[i]!.width).toBe(room.centers[i]!.width);
      expect(turned.centers[i]!.height).toBe(room.centers[i]!.height);
      expect(turned.centers[i]!.rotation).toBe((room.centers[i]!.rotation + 90) % 360);
    }
  });

  it('leaves seat offsets alone — the group carries the turn', () => {
    const room = furnishedRoom();
    const turned = rotateRoom(room, 'clockwise');

    expect(turned.centers[0]!.seats).toEqual(room.centers[0]!.seats);
  });

  it('turns seats to where the group now stands', () => {
    const room = furnishedRoom();
    const turned = rotateRoom(room, 'clockwise');

    const before = seatWorldPosition(room.centers[0]!, room.centers[0]!.seats[0]!);
    const after = seatWorldPosition(turned.centers[0]!, turned.centers[0]!.seats[0]!);

    // Clockwise maps (x, y) -> (oldHeight - y, x).
    expect(after.x).toBeCloseTo(room.height - before.y, 6);
    expect(after.y).toBeCloseTo(before.x, 6);
  });

  it('turns rectangle regions into a valid box, not a negative one', () => {
    const turned = rotateRoom(furnishedRoom(), 'clockwise');
    const region = turned.regions[0]!;

    expect(region.geometry.type).toBe('rectangle');
    if (region.geometry.type !== 'rectangle') return;
    expect(region.geometry.width).toBeGreaterThan(0);
    expect(region.geometry.height).toBeGreaterThan(0);
    // The full-width front band becomes a full-height band down one side.
    expect(region.geometry.height).toBe(1200);
  });

  it('turns every point of a polygon region', () => {
    const room = furnishedRoom();
    const turned = rotateRoom(room, 'clockwise');
    const geometry = turned.regions[1]!.geometry;

    expect(geometry.type).toBe('polygon');
    if (geometry.type !== 'polygon') return;
    expect(geometry.points).toHaveLength(3);
    expect(geometry.points[0]).toEqual({ x: room.height - 600, y: 0 });
  });

  it('turns labels with the room', () => {
    const room = furnishedRoom();
    const turned = rotateRoom(room, 'clockwise');

    expect(turned.labels[0]).toMatchObject({ x: room.height - 400, y: 60, rotation: 90 });
  });

  it('produces a schema-valid room', () => {
    const turned = rotateRoom(furnishedRoom(), 'counterclockwise');

    expect(roomDefinitionSchema.safeParse(turned).success).toBe(true);
  });
});
