import { describe, expect, it } from 'vitest';
import { createEmptyProject, createEmptyRoom } from '../domain/defaults';
import type { SeatingProject } from '../domain/types';
import { buildCenter } from '../templates/builders';
import { suggestReadableLayout, TARGET_NAME_POINTS } from './readability';

const LONG_NAMES = [
  'Maria Cecília Souza',
  'Mauricio Ferreira',
  'Ana Beatriz Silva',
  'João Pedro Alves',
];

/** Six groups of four filling a 1200x800 room — the dense, hardest case. */
function fullClassroom(names: string[] = LONG_NAMES): SeatingProject {
  const room = createEmptyRoom();
  room.width = 1200;
  room.height = 800;
  room.objects = [];
  room.centers = [];
  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      room.centers.push(
        buildCenter({
          id: `q${row}${column}`,
          x: 200 + column * 312,
          y: 220 + row * 212,
          seatCount: 4,
          columns: 2,
        }),
      );
    }
  }

  const project = createEmptyProject(room);
  project.roster = names.map((name, index) => ({ id: `st${index}`, name }));
  const seatIds = room.centers.flatMap((center) => center.seats.map((seat) => seat.id));
  project.assignments = project.roster.map((student, index) => ({
    studentId: student.id,
    seatId: seatIds[index]!,
    locked: false,
  }));
  return project;
}

describe('suggestReadableLayout', () => {
  it('reaches a readable size on a full classroom of long names', () => {
    const suggestion = suggestReadableLayout(fullClassroom());
    expect(suggestion.namePoints).toBeGreaterThanOrEqual(TARGET_NAME_POINTS);
  });

  it('shortens the name style when full names cannot be made legible', () => {
    const suggestion = suggestReadableLayout(fullClassroom());
    expect(suggestion.nameStyle).not.toBe('full');
  });

  it('keeps full names when they already fit legibly', () => {
    const suggestion = suggestReadableLayout(fullClassroom(['Ana', 'Léo', 'Ivo', 'Duda']));
    expect(suggestion.nameStyle).toBe('full');
    expect(suggestion.namePoints).toBeGreaterThanOrEqual(TARGET_NAME_POINTS);
  });

  it('beats the default settings it replaces', () => {
    const project = fullClassroom();
    const before = 11 * project.exportLayout.fontScale;
    const suggestion = suggestReadableLayout(project);
    expect(suggestion.fontScale * 11).toBeGreaterThan(before);
  });

  it('stays within the range the manual control allows', () => {
    const suggestion = suggestReadableLayout(fullClassroom());
    expect(suggestion.fontScale).toBeGreaterThanOrEqual(0.8);
    expect(suggestion.fontScale).toBeLessThanOrEqual(2);
  });

  it('handles a roster that has not been seated yet', () => {
    const project = fullClassroom();
    project.assignments = [];
    const suggestion = suggestReadableLayout(project);
    expect(suggestion.nameStyle).toBe('full');
    expect(Number.isFinite(suggestion.namePoints)).toBe(true);
  });
});
