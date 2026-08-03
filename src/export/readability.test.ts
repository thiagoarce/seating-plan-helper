import { describe, expect, it } from 'vitest';
import { createEmptyProject, createEmptyRoom } from '../domain/defaults';
import type { SeatingProject } from '../domain/types';
import { buildSeatPresentations, planNameFontSize } from '../shared/RoomGraphics';
import { buildCenter } from '../templates/builders';
import { planFitScale } from './PlanDocument';
import { suggestReadableLayout, TARGET_NAME_POINTS } from './readability';

/** Size the plan's names actually print at under the project's current settings. */
function currentNamePoints(project: SeatingProject): number {
  const seats = buildSeatPresentations(
    project.room,
    new Map(project.assignments.map((item) => [item.studentId, item.seatId])),
    new Map(project.roster.map((student) => [student.id, student.name])),
  );
  const { nameStyle, fontScale } = project.exportLayout;
  return planNameFontSize(seats, nameStyle, fontScale) * planFitScale(project);
}

const LONG_NAMES = [
  'Maria Cecília Souza',
  'Mauricio Ferreira',
  'Ana Beatriz Silva',
  'João Pedro Alves',
];

/**
 * A grid of four-seat groups. More groups means a wider drawing squeezed onto
 * the same page, which is what pushes names below the readable threshold.
 */
function fullClassroom(
  names: string[] = LONG_NAMES,
  grid: { columns: number; rows: number } = { columns: 3, rows: 2 },
): SeatingProject {
  const room = createEmptyRoom();
  room.width = 1200;
  room.height = 800;
  room.objects = [];
  room.centers = [];
  for (let row = 0; row < grid.rows; row += 1) {
    for (let column = 0; column < grid.columns; column += 1) {
      room.centers.push(
        buildCenter({
          id: `q${row}${column}`,
          x: 200 + column * 340,
          y: 220 + row * 240,
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
    // Six groups across leaves each desk too narrow on the page for a full
    // name at a readable size, so the style has to give.
    const crowded = fullClassroom(
      ['Maria Aparecida Gonçalves', 'Bartholomeu Vasconcellos', 'Anastácia Evangelista'],
      { columns: 6, rows: 3 },
    );

    expect(suggestReadableLayout(crowded).nameStyle).not.toBe('full');
  });

  it('keeps full names when they already fit legibly', () => {
    const suggestion = suggestReadableLayout(fullClassroom(['Ana', 'Léo', 'Ivo', 'Duda']));
    expect(suggestion.nameStyle).toBe('full');
    expect(suggestion.namePoints).toBeGreaterThanOrEqual(TARGET_NAME_POINTS);
  });

  it('never returns settings worse than the ones already in place', () => {
    const project = fullClassroom();
    const before = currentNamePoints(project);
    const suggestion = suggestReadableLayout(project);

    expect(suggestion.namePoints).toBeGreaterThanOrEqual(before);
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
