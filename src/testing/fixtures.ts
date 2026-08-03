/**
 * Shared fixtures for unit tests. Not part of the shipped bundle.
 *
 * The reference room is deliberately small and hand-checkable:
 *
 *   region "frente"  y in [0, 300)      region "fundo"  y in [300, 600]
 *
 *   board across the top edge
 *   center A (100,100) seats a1 a2      center B (300,100) seats b1 b2
 *   center C (100,400) seats c1 c2      center D (300,400) seats d1 d2
 *
 * With the default adjacency threshold (105 units here), A-B and C-D are
 * adjacent while the top and bottom rows are not.
 */

import { createDefaultGeneration, createEmptyProject } from '../domain/defaults';
import { buildRoomIndex } from '../domain/room';
import type { RoomIndex } from '../domain/room';
import type {
  GenerationSettings,
  RoomDefinition,
  Seat,
  SeatAssignment,
  SeatingCenter,
  SeatingProject,
  SeatingRule,
  Student,
} from '../domain/types';

const CENTER_WIDTH = 140;
const CENTER_HEIGHT = 60;

function makeCenter(id: string, x: number, y: number, seatIds: string[]): SeatingCenter {
  const seats: Seat[] = seatIds.map((seatId, position) => ({
    id: seatId,
    centerId: id,
    x: 20 + position * 70,
    y: 30,
    rotation: 0,
    enabled: true,
  }));
  return {
    id,
    name: id.toUpperCase(),
    x,
    y,
    width: CENTER_WIDTH,
    height: CENTER_HEIGHT,
    rotation: 0,
    seats,
  };
}

export function createTestRoom(): RoomDefinition {
  return {
    width: 1000,
    height: 600,
    orientation: 'landscape',
    grid: { size: 20, visible: true, snap: true },
    centers: [
      makeCenter('a', 100, 100, ['a1', 'a2']),
      makeCenter('b', 300, 100, ['b1', 'b2']),
      makeCenter('c', 100, 400, ['c1', 'c2']),
      makeCenter('d', 300, 400, ['d1', 'd2']),
    ],
    objects: [
      {
        id: 'board',
        type: 'board',
        name: 'Lousa',
        x: 100,
        y: 0,
        width: 600,
        height: 20,
        rotation: 0,
        shape: 'rectangle',
        visibleInExport: true,
      },
      {
        id: 'door',
        type: 'door',
        name: 'Porta',
        x: 960,
        y: 500,
        width: 40,
        height: 80,
        rotation: 0,
        shape: 'rectangle',
        visibleInExport: true,
      },
    ],
    regions: [
      {
        id: 'frente',
        name: 'Frente',
        geometry: { type: 'rectangle', x: 0, y: 0, width: 1000, height: 300 },
        visibleInEditor: true,
        visibleInExport: false,
      },
      {
        id: 'fundo',
        name: 'Fundo',
        geometry: { type: 'rectangle', x: 0, y: 300, width: 1000, height: 300 },
        visibleInEditor: true,
        visibleInExport: false,
      },
    ],
    labels: [],
  };
}

export function createTestStudents(count = 8): Student[] {
  const names = [
    'Ana',
    'Bruno',
    'Camila',
    'Diego',
    'Eduarda',
    'Felipe',
    'Gabriela',
    'Henrique',
    'Isabela',
    'João',
  ];
  return Array.from({ length: count }, (_, position) => ({
    id: `st${position + 1}`,
    name: names[position] ?? `Aluno ${position + 1}`,
  }));
}

export function createTestGeneration(room: RoomDefinition): GenerationSettings {
  return { ...createDefaultGeneration(room), attempts: 8, timeBudgetMs: 2000 };
}

export function createTestIndex(room: RoomDefinition = createTestRoom()): RoomIndex {
  return buildRoomIndex(room, createTestGeneration(room).adjacentCenterDistance);
}

export function nameMap(students: readonly Student[]): Map<string, string> {
  return new Map(students.map((student) => [student.id, student.name]));
}

/** Builds a placement from `[studentId, seatId]` tuples. */
export function placement(entries: Array<[string, string]>): Map<string, string> {
  return new Map(entries);
}

export interface TestProjectOptions {
  studentCount?: number;
  rules?: SeatingRule[];
  assignments?: SeatAssignment[];
  room?: RoomDefinition;
  seed?: number;
}

export function createTestProject(options: TestProjectOptions = {}): SeatingProject {
  const room = options.room ?? createTestRoom();
  const project = createEmptyProject(room);
  return {
    ...project,
    roster: createTestStudents(options.studentCount ?? 6),
    rules: options.rules ?? [],
    assignments: options.assignments ?? [],
    generation: { ...createTestGeneration(room), seed: options.seed ?? 12345 },
  };
}

/**
 * A rule literal with the boilerplate fields made optional. Distributing over
 * the union keeps each kind's own fields checked.
 */
export type RuleDraft = {
  [K in SeatingRule['kind']]: Omit<Extract<SeatingRule, { kind: K }>, 'enabled' | 'weight'> & {
    enabled?: boolean;
    weight?: number;
  };
}[SeatingRule['kind']];

/** Convenience builder that fills in the shared rule fields. */
export function makeRule(rule: RuleDraft): SeatingRule {
  return { enabled: true, weight: 1, ...rule } as SeatingRule;
}
