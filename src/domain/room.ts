/**
 * Derived, read-only views over a room definition.
 *
 * Evaluating rules and running the solver both need seat world positions,
 * region membership, and center adjacency many thousands of times. Computing
 * them once into a `RoomIndex` keeps the hot paths free of geometry work.
 */

import {
  centersAdjacent,
  distanceToObject,
  regionsForSeat,
  seatWorldPosition,
} from './geometry';
import type { Point, RoomDefinition, RoomObject, Seat, SeatingCenter } from './types';

export interface IndexedSeat {
  seat: Seat;
  center: SeatingCenter;
  position: Point;
  /** Ids of every region containing this seat. */
  regionIds: ReadonlySet<string>;
  /** Distance from this seat to each room object, keyed by object id. */
  objectDistances: ReadonlyMap<string, number>;
}

export interface RoomIndex {
  room: RoomDefinition;
  /** Every enabled seat, in stable document order. */
  seats: IndexedSeat[];
  seatById: ReadonlyMap<string, IndexedSeat>;
  centerById: ReadonlyMap<string, SeatingCenter>;
  objectById: ReadonlyMap<string, RoomObject>;
  /** Ids of centers adjacent to a given center. */
  adjacentCenterIds: ReadonlyMap<string, ReadonlySet<string>>;
  /** Cached seat-to-seat distances, keyed by `${aId}|${bId}` with a < b. */
  seatDistance: (aSeatId: string, bSeatId: string) => number;
}

function seatDistanceKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Builds the index. `adjacentCenterDistance` is the resolved gap below which
 * two centers count as adjacent (TECHNICAL_SPEC §6.3).
 */
export function buildRoomIndex(
  room: RoomDefinition,
  adjacentCenterDistance: number,
): RoomIndex {
  const centerById = new Map<string, SeatingCenter>();
  const objectById = new Map<string, RoomObject>();
  for (const center of room.centers) centerById.set(center.id, center);
  for (const object of room.objects) objectById.set(object.id, object);

  const seats: IndexedSeat[] = [];
  const seatById = new Map<string, IndexedSeat>();

  for (const center of room.centers) {
    for (const seat of center.seats) {
      if (!seat.enabled) continue;
      const position = seatWorldPosition(center, seat);
      const objectDistances = new Map<string, number>();
      for (const object of room.objects) {
        objectDistances.set(object.id, distanceToObject(position, object));
      }
      const indexed: IndexedSeat = {
        seat,
        center,
        position,
        regionIds: new Set(regionsForSeat(position, room.regions)),
        objectDistances,
      };
      seats.push(indexed);
      seatById.set(seat.id, indexed);
    }
  }

  const adjacentCenterIds = new Map<string, Set<string>>();
  for (const center of room.centers) adjacentCenterIds.set(center.id, new Set());
  for (let i = 0; i < room.centers.length; i += 1) {
    for (let j = i + 1; j < room.centers.length; j += 1) {
      const a = room.centers[i];
      const b = room.centers[j];
      if (!a || !b) continue;
      if (centersAdjacent(a, b, adjacentCenterDistance)) {
        adjacentCenterIds.get(a.id)?.add(b.id);
        adjacentCenterIds.get(b.id)?.add(a.id);
      }
    }
  }

  const distanceCache = new Map<string, number>();
  const seatDistance = (aSeatId: string, bSeatId: string): number => {
    if (aSeatId === bSeatId) return 0;
    const key = seatDistanceKey(aSeatId, bSeatId);
    const cached = distanceCache.get(key);
    if (cached !== undefined) return cached;
    const a = seatById.get(aSeatId);
    const b = seatById.get(bSeatId);
    if (!a || !b) return Number.POSITIVE_INFINITY;
    const value = Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
    distanceCache.set(key, value);
    return value;
  };

  return {
    room,
    seats,
    seatById,
    centerById,
    objectById,
    adjacentCenterIds,
    seatDistance,
  };
}

/** Count of assignable seats, i.e. seats that are enabled. */
export function assignableSeatCount(room: RoomDefinition): number {
  let count = 0;
  for (const center of room.centers) {
    for (const seat of center.seats) if (seat.enabled) count += 1;
  }
  return count;
}

/** Flattens every seat in the room, including disabled ones. */
export function allSeats(room: RoomDefinition): Array<{ seat: Seat; center: SeatingCenter }> {
  const result: Array<{ seat: Seat; center: SeatingCenter }> = [];
  for (const center of room.centers) {
    for (const seat of center.seats) result.push({ seat, center });
  }
  return result;
}
