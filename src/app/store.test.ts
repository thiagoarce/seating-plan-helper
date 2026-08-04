import { beforeEach, describe, expect, it } from 'vitest';
import { ptBR } from '../i18n/pt-BR';
import { createRoomFromTemplate } from '../templates/builtin';
import { createTestProject } from '../testing/fixtures';
import { useStore } from './store';
import type { SeatingSuggestion } from '../solver/types';

function seatOf(studentId: string): string | undefined {
  return useStore
    .getState()
    .project?.assignments.find((assignment) => assignment.studentId === studentId)?.seatId;
}

beforeEach(() => {
  useStore.getState().closeProject();
  useStore.getState().openProject(createTestProject({ studentCount: 4 }));
});

describe('assignment', () => {
  it('seats a student on an empty seat', () => {
    useStore.getState().assignStudent('st1', 'a1');
    expect(seatOf('st1')).toBe('a1');
  });

  it('moves a student between seats', () => {
    useStore.getState().assignStudent('st1', 'a1');
    useStore.getState().assignStudent('st1', 'b1');
    expect(seatOf('st1')).toBe('b1');
    expect(useStore.getState().project?.assignments).toHaveLength(1);
  });

  it('swaps when dropping onto an occupied seat', () => {
    useStore.getState().assignStudent('st1', 'a1');
    useStore.getState().assignStudent('st2', 'a2');
    useStore.getState().assignStudent('st1', 'a2');

    expect(seatOf('st1')).toBe('a2');
    expect(seatOf('st2')).toBe('a1');
  });

  it('displaces the occupant when the arriving student had no seat', () => {
    useStore.getState().assignStudent('st2', 'a1');
    useStore.getState().assignStudent('st1', 'a1');

    expect(seatOf('st1')).toBe('a1');
    expect(seatOf('st2')).toBeUndefined();
  });

  it('never seats two students on the same seat', () => {
    const state = useStore.getState();
    state.assignStudent('st1', 'a1');
    state.assignStudent('st2', 'a1');
    state.assignStudent('st3', 'a1');

    const assignments = useStore.getState().project?.assignments ?? [];
    const seatIds = assignments.map((item) => item.seatId);
    expect(new Set(seatIds).size).toBe(seatIds.length);
  });

  it('unassigns a student', () => {
    useStore.getState().assignStudent('st1', 'a1');
    useStore.getState().unassignStudent('st1');
    expect(seatOf('st1')).toBeUndefined();
  });

  it('keeps locked assignments when clearing', () => {
    useStore.getState().assignStudent('st1', 'a1');
    useStore.getState().assignStudent('st2', 'a2');
    useStore.getState().toggleLock('st1');
    useStore.getState().clearAssignments();

    expect(seatOf('st1')).toBe('a1');
    expect(seatOf('st2')).toBeUndefined();
  });
});

describe('undo / redo', () => {
  it('reverts the last mutation', () => {
    useStore.getState().assignStudent('st1', 'a1');
    useStore.getState().undo();
    expect(seatOf('st1')).toBeUndefined();
  });

  it('replays a reverted mutation', () => {
    useStore.getState().assignStudent('st1', 'a1');
    useStore.getState().undo();
    useStore.getState().redo();
    expect(seatOf('st1')).toBe('a1');
  });

  it('clears the redo stack on a new mutation', () => {
    useStore.getState().assignStudent('st1', 'a1');
    useStore.getState().undo();
    useStore.getState().assignStudent('st2', 'b1');
    expect(useStore.getState().future).toHaveLength(0);
    useStore.getState().redo();
    expect(seatOf('st1')).toBeUndefined();
  });

  it('does nothing when there is no history', () => {
    const before = useStore.getState().project;
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(before);
  });

  it('does not record silent commits in history', () => {
    const depth = useStore.getState().past.length;
    useStore.getState().commitSilently((project) => {
      project.metadata.title = 'Rascunho';
    });
    expect(useStore.getState().past).toHaveLength(depth);
    expect(useStore.getState().project?.metadata.title).toBe('Rascunho');
  });

  it('restores a deep-nested change exactly', () => {
    useStore.getState().updateRoom((room) => {
      const first = room.centers[0];
      if (first) first.x = 999;
    });
    useStore.getState().undo();
    expect(useStore.getState().project?.room.centers[0]?.x).toBe(100);
  });
});

describe('roster', () => {
  it('appends students', () => {
    useStore.getState().addStudents(['Novo', 'Outro'], 'append');
    expect(useStore.getState().project?.roster).toHaveLength(6);
  });

  it('replaces the roster and drops the old assignments', () => {
    useStore.getState().assignStudent('st1', 'a1');
    useStore.getState().addStudents(['Ana', 'Bruno'], 'replace');

    const project = useStore.getState().project;
    expect(project?.roster).toHaveLength(2);
    expect(project?.assignments).toHaveLength(0);
  });

  it('ignores blank names on import', () => {
    useStore.getState().addStudents(['Ana', '   ', ''], 'replace');
    expect(useStore.getState().project?.roster).toHaveLength(1);
  });

  it('removes a student together with their seat', () => {
    useStore.getState().assignStudent('st1', 'a1');
    useStore.getState().removeStudent('st1');

    const project = useStore.getState().project;
    expect(project?.roster.some((student) => student.id === 'st1')).toBe(false);
    expect(project?.assignments).toHaveLength(0);
  });

  it('sorts with a locale collator', () => {
    useStore.getState().addStudents(['Zeca', 'Ana', 'Édson'], 'replace');
    useStore.getState().sortRoster(new Intl.Collator('pt-BR', { sensitivity: 'base' }));
    expect(useStore.getState().project?.roster.map((student) => student.name)).toEqual([
      'Ana',
      'Édson',
      'Zeca',
    ]);
  });
});

describe('room changes', () => {
  it('drops assignments whose seat disappeared', () => {
    useStore.getState().assignStudent('st1', 'a1');
    useStore.getState().updateRoom((room) => {
      room.centers = room.centers.filter((center) => center.id !== 'a');
    });
    expect(useStore.getState().project?.assignments).toHaveLength(0);
  });

  it('keeps assignments on surviving seats', () => {
    useStore.getState().assignStudent('st1', 'b1');
    useStore.getState().updateRoom((room) => {
      room.centers = room.centers.filter((center) => center.id !== 'a');
    });
    expect(seatOf('st1')).toBe('b1');
  });

  it('updates orientation with the room size', () => {
    useStore.getState().setRoomSize(600, 900);
    expect(useStore.getState().project?.room.orientation).toBe('portrait');
  });

  it('accepts a template room', () => {
    useStore.getState().updateRoom((room) => {
      const template = createRoomFromTemplate('groups-of-four', ptBR);
      room.centers = template.centers;
      room.objects = template.objects;
      room.regions = template.regions;
    });
    expect(useStore.getState().project?.room.centers).toHaveLength(6);
  });
});

describe('applySuggestion', () => {
  it('replaces assignments and keeps user locks', () => {
    useStore.getState().assignStudent('st1', 'a1');
    useStore.getState().toggleLock('st1');

    const suggestion: SeatingSuggestion = {
      id: 'plan1',
      seed: 1,
      assignments: [
        { studentId: 'st1', seatId: 'a1', locked: true },
        { studentId: 'st2', seatId: 'c1', locked: false },
      ],
      score: {
        total: 100,
        valid: true,
        requiredSatisfied: 0,
        requiredTotal: 0,
        preferredSatisfied: 0,
        preferredTotal: 0,
        weightedPreferenceRatio: 1,
        violations: [],
        explanation: [],
      },
    };

    useStore.getState().applySuggestion(suggestion);

    const assignments = useStore.getState().project?.assignments ?? [];
    expect(assignments).toHaveLength(2);
    expect(assignments.find((item) => item.studentId === 'st1')?.locked).toBe(true);
    expect(assignments.find((item) => item.studentId === 'st2')?.locked).toBe(false);
    expect(useStore.getState().generation.appliedSuggestionId).toBe('plan1');
  });
});

describe('rules', () => {
  it('adds, updates, and removes', () => {
    useStore.getState().addRule({
      id: 'r1',
      kind: 'pairSameCenter',
      enabled: true,
      severity: 'preferred',
      weight: 1,
      studentIds: ['st1', 'st2'],
    });
    expect(useStore.getState().project?.rules).toHaveLength(1);

    useStore.getState().updateRule('r1', { severity: 'required' });
    expect(useStore.getState().project?.rules[0]?.severity).toBe('required');

    useStore.getState().removeRule('r1');
    expect(useStore.getState().project?.rules).toHaveLength(0);
  });
});

describe('rotateRoom', () => {
  it('turns the room and flips the page to match', () => {
    useStore.getState().openProject(
      createTestProject({ studentCount: 4, room: createRoomFromTemplate('groups-of-four', ptBR) }),
    );
    const before = useStore.getState().project!.room;
    const pageBefore = useStore.getState().project!.exportLayout.orientation;

    useStore.getState().rotateRoom('clockwise');
    const after = useStore.getState().project!;

    expect(after.room.width).toBe(before.height);
    expect(after.room.height).toBe(before.width);
    expect(after.exportLayout.orientation).not.toBe(pageBefore);
  });

  it('is undoable in one step', () => {
    useStore.getState().openProject(
      createTestProject({ studentCount: 4, room: createRoomFromTemplate('groups-of-four', ptBR) }),
    );
    const before = structuredClone(useStore.getState().project!.room);

    useStore.getState().rotateRoom('clockwise');
    useStore.getState().undo();

    expect(useStore.getState().project!.room).toEqual(before);
  });
});
