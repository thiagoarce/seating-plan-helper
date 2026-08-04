import { describe, expect, it } from 'vitest';
import { createEmptyProject, createEmptyRoom, SEAT_DEPTH } from '../domain/defaults';
import type { Seat, SeatingProject } from '../domain/types';
import {
  NAME_BASE_FONT_SIZE as BASE,
  buildSeatPresentations,
  fitSeatNameSize,
  planNameFontSize,
  wrapSeatNameAt,
} from '../shared/RoomGraphics';
import { buildCenter } from '../templates/builders';
import { analysePlan, contentBounds } from './PlanDocument';

const VIEW_OPTIONS = {
  showRegions: false,
  showObjects: true,
  showSeats: true,
  showEmptySeats: true,
  showCenterOutlines: true,
  nameStyle: 'full' as const,
  fontScale: 1,
};

/** A room far larger than the single small group of desks placed in it. */
function projectWithOneGroup(): SeatingProject {
  const room = createEmptyRoom();
  room.width = 1200;
  room.height = 800;
  room.objects = [];
  room.centers = [buildCenter({ id: 'g1', x: 500, y: 400, seatCount: 4, columns: 2 })];
  return createEmptyProject(room);
}

describe('contentBounds', () => {
  it('crops to the desks in use rather than the whole room', () => {
    const project = projectWithOneGroup();
    const bounds = contentBounds(project, VIEW_OPTIONS);

    expect(bounds.width).toBeLessThan(project.room.width / 3);
    expect(bounds.height).toBeLessThan(project.room.height / 3);
    // The group sits well inside the room, so the crop starts away from 0.
    expect(bounds.x).toBeGreaterThan(400);
    expect(bounds.y).toBeGreaterThan(300);
  });

  it('leaves padding around the content instead of touching its edges', () => {
    const project = projectWithOneGroup();
    const center = project.room.centers[0]!;
    const bounds = contentBounds(project, VIEW_OPTIONS);

    expect(bounds.x).toBeLessThan(center.x);
    expect(bounds.y).toBeLessThan(center.y);
    expect(bounds.x + bounds.width).toBeGreaterThan(center.x + center.width);
    expect(bounds.y + bounds.height).toBeGreaterThan(center.y + center.height);
  });

  it('falls back to the whole room when the option is off', () => {
    const project = projectWithOneGroup();
    project.exportLayout.fitToContent = false;
    const bounds = contentBounds(project, VIEW_OPTIONS);

    expect(bounds).toEqual({ x: 0, y: 0, width: 1200, height: 800 });
  });

  it('falls back to the whole room when there is nothing to draw', () => {
    const project = createEmptyProject(createEmptyRoom());
    project.room.objects = [];
    const bounds = contentBounds(project, VIEW_OPTIONS);

    expect(bounds.width).toBe(project.room.width);
    expect(bounds.height).toBe(project.room.height);
  });

  it('ignores objects that are hidden from the export', () => {
    const project = projectWithOneGroup();
    const cropped = contentBounds(project, VIEW_OPTIONS);
    project.room.objects = [
      {
        id: 'far',
        type: 'cabinet',
        name: 'Armário',
        x: 1100,
        y: 700,
        width: 80,
        height: 60,
        rotation: 0,
        shape: 'rectangle',
        visibleInExport: false,
      },
    ];

    expect(contentBounds(project, VIEW_OPTIONS)).toEqual(cropped);
  });
});

describe('seat name fitting', () => {
  const rectangular: Seat = {
    id: 's1',
    centerId: 'c1',
    x: 0,
    y: 0,
    rotation: 0,
    enabled: true,
  };
  const trapezoid: Seat = { ...rectangular, deskShape: 'trapezoid' };

  it('never draws more lines than the desk depth allows', () => {
    const name = 'Maria Cecília de Souza Lima';
    const size = fitSeatNameSize(name, rectangular, BASE);
    const wrapped = wrapSeatNameAt(name, rectangular, size);

    expect(wrapped.lines.length * wrapped.fontSize * 1.15).toBeLessThanOrEqual(SEAT_DEPTH);
  });

  it('fits a longer name on the deeper trapezoid desk than on a flat one', () => {
    const name = 'Maria Cecília de Souza Lima';

    expect(fitSeatNameSize(name, trapezoid, BASE)).toBeGreaterThanOrEqual(
      fitSeatNameSize(name, rectangular, BASE),
    );
  });

  it('reports overflow only when even the smallest size cannot fit', () => {
    const name = 'Wolfeschlegelsteinhausenbergerdorff';
    const size = fitSeatNameSize(name, rectangular, BASE);

    expect(wrapSeatNameAt(name, rectangular, size).overflows).toBe(true);
    expect(wrapSeatNameAt('Ana', rectangular, fitSeatNameSize('Ana', rectangular, BASE)).overflows).toBe(
      false,
    );
  });

  it('does not shrink a name just because its desk is turned sideways', () => {
    // The name is laid out in the desk's own frame and turned with it, so a
    // quarter-turned desk holds exactly as much text as a flat one.
    const name = 'Maria Beatriz Oliveira';
    const turned: Seat = { ...rectangular, rotation: 270 };

    expect(fitSeatNameSize(name, turned, BASE)).toBe(fitSeatNameSize(name, rectangular, BASE));
  });

  it('gives every seated student the same name size', () => {
    const hardest = 'Wolfeschlegelsteinhausenbergerdorff';
    const project = projectWithOneGroup();
    project.roster = [
      { id: 'short', name: 'Ana' },
      { id: 'long', name: hardest },
    ];
    const seatIds = project.room.centers[0]!.seats.map((seat) => seat.id);
    const presentations = buildSeatPresentations(
      project.room,
      new Map([
        ['short', seatIds[0]!],
        ['long', seatIds[1]!],
      ]),
      new Map(project.roster.map((student) => [student.id, student.name])),
    );

    const shared = planNameFontSize(presentations, 'full', 1);
    const alone = presentations.map((presentation) =>
      fitSeatNameSize(presentation.studentName ?? '', presentation.seat, BASE),
    );

    // Every desk settles on the size the hardest name can manage — sizing each
    // desk on its own is what left one name smaller than its neighbour.
    expect(shared).toBe(Math.min(...alone));
    expect(Math.max(...alone)).toBeGreaterThan(shared);
  });
});

describe('analysePlan', () => {
  it('flags names that overflow their desk', () => {
    const project = projectWithOneGroup();
    project.roster = [{ id: 'st1', name: 'Wolfeschlegelsteinhausenbergerdorff' }];
    project.assignments = [{ studentId: 'st1', seatId: 'g1-s1', locked: false }];

    expect(analysePlan(project).overflowingNames).toContain(
      'Wolfeschlegelsteinhausenbergerdorff',
    );
  });

  it('stays quiet for a name that fits', () => {
    const project = projectWithOneGroup();
    project.roster = [{ id: 'st1', name: 'Ana' }];
    project.assignments = [{ studentId: 'st1', seatId: 'g1-s1', locked: false }];

    expect(analysePlan(project).overflowingNames).toEqual([]);
  });
});
