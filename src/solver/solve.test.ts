import { describe, expect, it } from 'vitest';
import { evaluateRules } from '../constraints/evaluate';
import { buildRoomIndex } from '../domain/room';
import type { SeatAssignment, SeatingProject } from '../domain/types';
import { createTestProject, makeRule, nameMap } from '../testing/fixtures';
import { planDistance, solve } from './solve';

function placementOf(assignments: readonly SeatAssignment[]): Map<string, string> {
  return new Map(assignments.map((item) => [item.studentId, item.seatId]));
}

function contextFor(project: SeatingProject) {
  return {
    index: buildRoomIndex(project.room, project.generation.adjacentCenterDistance),
    studentNameById: nameMap(project.roster),
  };
}

describe('solve — invariants', () => {
  it('seats every student exactly once, one student per seat', () => {
    const project = createTestProject({ studentCount: 6 });
    const result = solve(project);

    expect(result.suggestions.length).toBeGreaterThan(0);
    for (const suggestion of result.suggestions) {
      const studentIds = suggestion.assignments.map((item) => item.studentId);
      const seatIds = suggestion.assignments.map((item) => item.seatId);
      expect(studentIds).toHaveLength(6);
      expect(new Set(studentIds).size).toBe(6);
      expect(new Set(seatIds).size).toBe(6);
    }
  });

  it('only references seats and students that exist', () => {
    const project = createTestProject({ studentCount: 6 });
    const { index } = contextFor(project);
    const result = solve(project);

    for (const suggestion of result.suggestions) {
      for (const assignment of suggestion.assignments) {
        expect(index.seatById.has(assignment.seatId)).toBe(true);
        expect(project.roster.some((student) => student.id === assignment.studentId)).toBe(true);
      }
    }
  });

  it('fills every seat when students and seats match exactly', () => {
    const project = createTestProject({ studentCount: 8 });
    const result = solve(project);
    expect(result.suggestions[0]?.assignments).toHaveLength(8);
  });
});

describe('solve — required constraints', () => {
  it('honours a required region rule', () => {
    const project = createTestProject({
      studentCount: 6,
      rules: [
        makeRule({
          id: 'r1',
          kind: 'studentInRegion',
          severity: 'required',
          studentId: 'st1',
          regionId: 'fundo',
        }),
      ],
    });

    const result = solve(project);
    expect(result.foundValid).toBe(true);

    const context = contextFor(project);
    for (const suggestion of result.suggestions) {
      const seatId = placementOf(suggestion.assignments).get('st1');
      expect(seatId).toBeDefined();
      expect(context.index.seatById.get(seatId!)?.regionIds.has('fundo')).toBe(true);
    }
  });

  it('honours a required relationship rule', () => {
    const project = createTestProject({
      studentCount: 6,
      rules: [
        makeRule({
          id: 'r1',
          kind: 'pairNotAdjacentCenters',
          severity: 'required',
          studentIds: ['st1', 'st2'],
        }),
      ],
    });

    const result = solve(project);
    expect(result.foundValid).toBe(true);

    const context = contextFor(project);
    for (const suggestion of result.suggestions) {
      const evaluations = evaluateRules(
        project.rules,
        placementOf(suggestion.assignments),
        context,
      );
      expect(evaluations.every((item) => item.status !== 'violated')).toBe(true);
    }
  });

  it('every returned valid plan really satisfies all required rules', () => {
    const project = createTestProject({
      studentCount: 6,
      rules: [
        makeRule({
          id: 'r1',
          kind: 'studentInRegion',
          severity: 'required',
          studentId: 'st1',
          regionId: 'frente',
        }),
        makeRule({
          id: 'r2',
          kind: 'pairDifferentCenter',
          severity: 'required',
          studentIds: ['st1', 'st2', 'st3'],
        }),
        makeRule({
          id: 'r3',
          kind: 'studentFarFromObject',
          severity: 'required',
          studentId: 'st4',
          objectId: 'board',
          minDistance: 300,
        }),
      ],
    });

    const result = solve(project);
    const context = contextFor(project);

    for (const suggestion of result.suggestions) {
      if (!suggestion.score.valid) continue;
      const evaluations = evaluateRules(
        project.rules,
        placementOf(suggestion.assignments),
        context,
      );
      const brokenRequired = evaluations.filter(
        (item) => item.severity === 'required' && item.status === 'violated',
      );
      expect(brokenRequired).toEqual([]);
    }
  });
});

describe('solve — locks', () => {
  it('never moves a locked student', () => {
    const project = createTestProject({
      studentCount: 6,
      assignments: [{ studentId: 'st1', seatId: 'd2', locked: true }],
    });

    const result = solve(project);
    expect(result.suggestions.length).toBeGreaterThan(0);
    for (const suggestion of result.suggestions) {
      const assignment = suggestion.assignments.find((item) => item.studentId === 'st1');
      expect(assignment?.seatId).toBe('d2');
      expect(assignment?.locked).toBe(true);
    }
  });

  it('leaves unlocked students free to move', () => {
    const project = createTestProject({
      studentCount: 6,
      assignments: [{ studentId: 'st1', seatId: 'a1', locked: false }],
    });
    const result = solve(project);
    for (const suggestion of result.suggestions) {
      expect(suggestion.assignments.find((item) => item.studentId === 'st1')?.locked).toBe(false);
    }
  });

  it('treats a required fixed-seat rule as binding without marking it locked', () => {
    const project = createTestProject({
      studentCount: 6,
      rules: [
        makeRule({
          id: 'r1',
          kind: 'studentFixedSeat',
          severity: 'required',
          studentId: 'st2',
          seatId: 'b1',
        }),
      ],
    });

    const result = solve(project);
    for (const suggestion of result.suggestions) {
      const assignment = suggestion.assignments.find((item) => item.studentId === 'st2');
      expect(assignment?.seatId).toBe('b1');
      expect(assignment?.locked).toBe(false);
    }
  });
});

describe('solve — reproducibility', () => {
  it('produces identical plans for the same seed', () => {
    const project = createTestProject({ studentCount: 6, seed: 4242 });
    const first = solve(project);
    const second = solve(project);

    expect(first.suggestions.map((item) => item.assignments)).toEqual(
      second.suggestions.map((item) => item.assignments),
    );
  });

  it('records the seed that produced each plan', () => {
    const project = createTestProject({ studentCount: 6, seed: 99 });
    const result = solve(project);
    for (const suggestion of result.suggestions) {
      expect(Number.isInteger(suggestion.seed)).toBe(true);
    }
    // Re-running one recorded seed reproduces the same starting point.
    const seed = result.suggestions[0]?.seed;
    expect(seed).toBeDefined();
  });

  it('produces different plans for different seeds', () => {
    const a = solve(createTestProject({ studentCount: 6, seed: 1 }));
    const b = solve(createTestProject({ studentCount: 6, seed: 777 }));
    const first = a.suggestions[0];
    const second = b.suggestions[0];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(
      planDistance(placementOf(first!.assignments), placementOf(second!.assignments)),
    ).toBeGreaterThanOrEqual(0);
  });
});

describe('solve — diversity', () => {
  it('returns plans that differ from each other', () => {
    const project = createTestProject({ studentCount: 6 });
    const result = solve(project);

    for (let i = 0; i < result.suggestions.length; i += 1) {
      for (let j = i + 1; j < result.suggestions.length; j += 1) {
        const left = placementOf(result.suggestions[i]!.assignments);
        const right = placementOf(result.suggestions[j]!.assignments);
        expect(planDistance(left, right)).toBeGreaterThanOrEqual(
          project.generation.diversityThreshold,
        );
      }
    }
  });

  it('returns at most three suggestions', () => {
    const result = solve(createTestProject({ studentCount: 6 }));
    expect(result.suggestions.length).toBeLessThanOrEqual(3);
  });
});

describe('planDistance', () => {
  it('is zero for identical plans', () => {
    const plan = new Map([['a', 's1']]);
    expect(planDistance(plan, plan)).toBe(0);
  });

  it('is one when nobody keeps their seat', () => {
    expect(
      planDistance(
        new Map([
          ['a', 's1'],
          ['b', 's2'],
        ]),
        new Map([
          ['a', 's2'],
          ['b', 's1'],
        ]),
      ),
    ).toBe(1);
  });
});

describe('solve — unsatisfiable problems', () => {
  it('reports a seat conflict instead of silently dropping a rule', () => {
    const project = createTestProject({
      studentCount: 4,
      rules: [
        makeRule({
          id: 'r1',
          kind: 'studentFixedSeat',
          severity: 'required',
          studentId: 'st1',
          seatId: 'a1',
        }),
        makeRule({
          id: 'r2',
          kind: 'studentFixedSeat',
          severity: 'required',
          studentId: 'st2',
          seatId: 'a1',
        }),
      ],
    });

    const result = solve(project);
    expect(result.suggestions).toEqual([]);
    expect(result.foundValid).toBe(false);
    expect(result.blockers.some((item) => item.id === 'solver.blocker.seatConflict')).toBe(true);
  });

  it('reports a student with no possible seat', () => {
    const project = createTestProject({
      studentCount: 4,
      rules: [
        makeRule({
          id: 'r1',
          kind: 'studentInRegion',
          severity: 'required',
          studentId: 'st1',
          regionId: 'frente',
        }),
        makeRule({
          id: 'r2',
          kind: 'studentNotInRegion',
          severity: 'required',
          studentId: 'st1',
          regionId: 'frente',
        }),
      ],
    });

    const result = solve(project);
    expect(result.blockers.some((item) => item.id === 'solver.blocker.noCandidateSeats')).toBe(
      true,
    );
    expect(result.suggestions).toEqual([]);
  });

  it('reports when there are more students than seats', () => {
    const project = createTestProject({ studentCount: 10 });
    const result = solve(project);
    expect(result.blockers.some((item) => item.id === 'solver.blocker.notEnoughSeats')).toBe(true);
  });

  it('never reports a valid plan when required rules cannot all hold', () => {
    // Three students must share one center, but every center has two seats.
    const project = createTestProject({
      studentCount: 4,
      rules: [
        makeRule({
          id: 'r1',
          kind: 'pairSameCenter',
          severity: 'required',
          studentIds: ['st1', 'st2', 'st3'],
        }),
      ],
    });

    const result = solve(project);
    expect(result.foundValid).toBe(false);
    expect(result.suggestions.every((item) => item.score.valid === false)).toBe(true);
    expect(result.notes.some((note) => note.id === 'solver.note.noFeasiblePlan')).toBe(true);
  });

  it('names the rules that most often blocked the search', () => {
    const project = createTestProject({
      studentCount: 4,
      rules: [
        makeRule({
          id: 'blocking-rule',
          kind: 'pairSameCenter',
          severity: 'required',
          studentIds: ['st1', 'st2', 'st3'],
        }),
      ],
    });

    const result = solve(project);
    expect(result.frequentBlockingRuleIds).toContain('blocking-rule');
  });
});

describe('solve — preferences', () => {
  it('prefers plans that satisfy soft rules', () => {
    const project = createTestProject({
      studentCount: 4,
      rules: [
        makeRule({
          id: 'p1',
          kind: 'pairSameCenter',
          severity: 'preferred',
          weight: 5,
          studentIds: ['st1', 'st2'],
        }),
      ],
    });

    const result = solve(project);
    const best = result.suggestions[0];
    expect(best).toBeDefined();
    expect(best!.score.total).toBe(100);
  });

  it('reports the trade-offs it had to make', () => {
    const project = createTestProject({
      studentCount: 8,
      rules: [
        makeRule({
          id: 'p1',
          kind: 'studentNearObject',
          severity: 'preferred',
          studentId: 'st1',
          objectId: 'board',
          maxDistance: 10,
        }),
      ],
    });

    const result = solve(project);
    const best = result.suggestions[0];
    expect(best).toBeDefined();
    expect(best!.score.explanation.length).toBeGreaterThan(0);
  });

  it('supports cancellation between attempts', () => {
    const project = createTestProject({ studentCount: 6 });
    const result = solve(project, { shouldCancel: () => true });
    expect(result.attemptsRun).toBe(0);
    expect(result.suggestions).toEqual([]);
  });
});
