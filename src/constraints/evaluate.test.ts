import { beforeEach, describe, expect, it } from 'vitest';
import type { RoomIndex } from '../domain/room';
import type { SeatingRule } from '../domain/types';
import {
  createTestIndex,
  createTestStudents,
  nameMap,
  placement,
} from '../testing/fixtures';
import { evaluateRule, evaluateRules, studentPairs } from './evaluate';
import type { EvaluationContext } from './evaluate';

const students = createTestStudents(4); // st1..st4

let index: RoomIndex;
let context: EvaluationContext;

beforeEach(() => {
  index = createTestIndex();
  context = { index, studentNameById: nameMap(students) };
});

function rule<T extends SeatingRule>(partial: Omit<T, 'id' | 'enabled' | 'weight'> & Partial<T>): T {
  return { id: 'r1', enabled: true, weight: 1, ...partial } as T;
}

describe('studentPairs', () => {
  it('produces every unordered pair', () => {
    expect(studentPairs(['a', 'b', 'c'])).toEqual([
      ['a', 'b'],
      ['a', 'c'],
      ['b', 'c'],
    ]);
  });

  it('skips duplicate ids', () => {
    expect(studentPairs(['a', 'a'])).toEqual([]);
  });
});

describe('room index', () => {
  it('places seats in the expected regions', () => {
    expect(index.seatById.get('a1')?.regionIds.has('frente')).toBe(true);
    expect(index.seatById.get('c1')?.regionIds.has('fundo')).toBe(true);
    expect(index.seatById.get('c1')?.regionIds.has('frente')).toBe(false);
  });

  it('marks side-by-side centers adjacent and distant rows not adjacent', () => {
    expect(index.adjacentCenterIds.get('a')?.has('b')).toBe(true);
    expect(index.adjacentCenterIds.get('a')?.has('c')).toBe(false);
  });
});

describe('studentInRegion / studentNotInRegion', () => {
  it('is satisfied when the seat falls inside the region', () => {
    const result = evaluateRule(
      rule({ kind: 'studentInRegion', severity: 'required', studentId: 'st1', regionId: 'frente' }),
      placement([['st1', 'a1']]),
      context,
    );
    expect(result.status).toBe('satisfied');
  });

  it('is violated when the seat falls outside', () => {
    const result = evaluateRule(
      rule({ kind: 'studentInRegion', severity: 'required', studentId: 'st1', regionId: 'frente' }),
      placement([['st1', 'c1']]),
      context,
    );
    expect(result.status).toBe('violated');
    expect(result.involvedStudentIds).toEqual(['st1']);
  });

  it('inverts for studentNotInRegion', () => {
    const notIn = rule<SeatingRule>({
      kind: 'studentNotInRegion',
      severity: 'required',
      studentId: 'st1',
      regionId: 'frente',
    });
    expect(evaluateRule(notIn, placement([['st1', 'a1']]), context).status).toBe('violated');
    expect(evaluateRule(notIn, placement([['st1', 'c1']]), context).status).toBe('satisfied');
  });

  it('is not applicable while the student has no seat', () => {
    const result = evaluateRule(
      rule({ kind: 'studentInRegion', severity: 'required', studentId: 'st1', regionId: 'frente' }),
      placement([]),
      context,
    );
    expect(result.status).toBe('notApplicable');
    expect(result.message.id).toBe('rule.status.unassigned');
  });

  it('reports an orphan reference when the region was deleted', () => {
    const result = evaluateRule(
      rule({ kind: 'studentInRegion', severity: 'required', studentId: 'st1', regionId: 'gone' }),
      placement([['st1', 'a1']]),
      context,
    );
    expect(result.status).toBe('notApplicable');
    expect(result.message.id).toBe('rule.orphan.region');
  });

  it('reports an orphan reference when the student was removed', () => {
    const result = evaluateRule(
      rule({ kind: 'studentInRegion', severity: 'required', studentId: 'ghost', regionId: 'frente' }),
      placement([['ghost', 'a1']]),
      context,
    );
    expect(result.message.id).toBe('rule.orphan.student');
  });
});

describe('object proximity', () => {
  // a1 sits 110 units from the board; c1 sits 410 units from it.
  it('satisfies studentNearObject within the threshold', () => {
    const near = rule<SeatingRule>({
      kind: 'studentNearObject',
      severity: 'preferred',
      studentId: 'st1',
      objectId: 'board',
      maxDistance: 150,
    });
    expect(evaluateRule(near, placement([['st1', 'a1']]), context).status).toBe('satisfied');
    expect(evaluateRule(near, placement([['st1', 'c1']]), context).status).toBe('violated');
  });

  it('satisfies studentFarFromObject beyond the threshold', () => {
    const far = rule<SeatingRule>({
      kind: 'studentFarFromObject',
      severity: 'required',
      studentId: 'st1',
      objectId: 'board',
      minDistance: 300,
    });
    expect(evaluateRule(far, placement([['st1', 'c1']]), context).status).toBe('satisfied');
    expect(evaluateRule(far, placement([['st1', 'a1']]), context).status).toBe('violated');
  });

  it('reports the measured distance in the message', () => {
    const result = evaluateRule(
      rule({
        kind: 'studentNearObject',
        severity: 'preferred',
        studentId: 'st1',
        objectId: 'board',
        maxDistance: 50,
      }),
      placement([['st1', 'a1']]),
      context,
    );
    expect(result.message.values?.['distance']).toBe(110);
  });

  it('reports an orphan reference for a deleted object', () => {
    const result = evaluateRule(
      rule({
        kind: 'studentNearObject',
        severity: 'preferred',
        studentId: 'st1',
        objectId: 'gone',
        maxDistance: 50,
      }),
      placement([['st1', 'a1']]),
      context,
    );
    expect(result.message.id).toBe('rule.orphan.object');
  });
});

describe('studentFixedSeat', () => {
  it('is satisfied only on the exact seat', () => {
    const fixed = rule<SeatingRule>({
      kind: 'studentFixedSeat',
      severity: 'required',
      studentId: 'st1',
      seatId: 'a1',
    });
    expect(evaluateRule(fixed, placement([['st1', 'a1']]), context).status).toBe('satisfied');
    expect(evaluateRule(fixed, placement([['st1', 'a2']]), context).status).toBe('violated');
  });

  it('reports an orphan reference for a deleted seat', () => {
    const result = evaluateRule(
      rule({ kind: 'studentFixedSeat', severity: 'required', studentId: 'st1', seatId: 'gone' }),
      placement([['st1', 'a1']]),
      context,
    );
    expect(result.message.id).toBe('rule.orphan.seat');
  });
});

describe('relationship rules', () => {
  it('pairSameCenter compares center ids', () => {
    const sameCenter = rule<SeatingRule>({
      kind: 'pairSameCenter',
      severity: 'required',
      studentIds: ['st1', 'st2'],
    });
    expect(
      evaluateRule(sameCenter, placement([['st1', 'a1'], ['st2', 'a2']]), context).status,
    ).toBe('satisfied');
    expect(
      evaluateRule(sameCenter, placement([['st1', 'a1'], ['st2', 'b1']]), context).status,
    ).toBe('violated');
  });

  it('pairDifferentCenter is the inverse', () => {
    const different = rule<SeatingRule>({
      kind: 'pairDifferentCenter',
      severity: 'required',
      studentIds: ['st1', 'st2'],
    });
    expect(
      evaluateRule(different, placement([['st1', 'a1'], ['st2', 'a2']]), context).status,
    ).toBe('violated');
    expect(
      evaluateRule(different, placement([['st1', 'a1'], ['st2', 'b1']]), context).status,
    ).toBe('satisfied');
  });

  it('pairNotAdjacentCenters rejects both the same center and neighbouring ones', () => {
    const notAdjacent = rule<SeatingRule>({
      kind: 'pairNotAdjacentCenters',
      severity: 'required',
      studentIds: ['st1', 'st2'],
    });
    expect(
      evaluateRule(notAdjacent, placement([['st1', 'a1'], ['st2', 'a2']]), context).status,
    ).toBe('violated');
    expect(
      evaluateRule(notAdjacent, placement([['st1', 'a1'], ['st2', 'b1']]), context).status,
    ).toBe('violated');
    expect(
      evaluateRule(notAdjacent, placement([['st1', 'a1'], ['st2', 'c1']]), context).status,
    ).toBe('satisfied');
  });

  it('pairNear uses seat distance', () => {
    // a1 to a2 is 70 units; a1 to c1 is 300.
    const near = rule<SeatingRule>({
      kind: 'pairNear',
      severity: 'preferred',
      studentIds: ['st1', 'st2'],
      maxDistance: 100,
    });
    expect(evaluateRule(near, placement([['st1', 'a1'], ['st2', 'a2']]), context).status).toBe(
      'satisfied',
    );
    expect(evaluateRule(near, placement([['st1', 'a1'], ['st2', 'c1']]), context).status).toBe(
      'violated',
    );
  });

  it('pairMinimumDistance enforces a floor', () => {
    const minimum = rule<SeatingRule>({
      kind: 'pairMinimumDistance',
      severity: 'required',
      studentIds: ['st1', 'st2'],
      minDistance: 250,
    });
    expect(
      evaluateRule(minimum, placement([['st1', 'a1'], ['st2', 'c1']]), context).status,
    ).toBe('satisfied');
    expect(
      evaluateRule(minimum, placement([['st1', 'a1'], ['st2', 'a2']]), context).status,
    ).toBe('violated');
  });

  it('applies the predicate to every pair of a larger set', () => {
    const differentCenters = rule<SeatingRule>({
      kind: 'pairDifferentCenter',
      severity: 'required',
      studentIds: ['st1', 'st2', 'st3'],
    });
    const allApart = placement([
      ['st1', 'a1'],
      ['st2', 'b1'],
      ['st3', 'c1'],
    ]);
    expect(evaluateRule(differentCenters, allApart, context).status).toBe('satisfied');

    const twoTogether = placement([
      ['st1', 'a1'],
      ['st2', 'a2'],
      ['st3', 'c1'],
    ]);
    const result = evaluateRule(differentCenters, twoTogether, context);
    expect(result.status).toBe('violated');
    expect(result.involvedStudentIds.sort()).toEqual(['st1', 'st2']);
  });

  it('is not applicable while any member of the set is unplaced', () => {
    const result = evaluateRule(
      rule({ kind: 'pairSameCenter', severity: 'required', studentIds: ['st1', 'st2'] }),
      placement([['st1', 'a1']]),
      context,
    );
    expect(result.status).toBe('notApplicable');
  });
});

describe('evaluateRules', () => {
  it('skips disabled rules', () => {
    const rules: SeatingRule[] = [
      rule({ kind: 'studentInRegion', severity: 'required', studentId: 'st1', regionId: 'frente' }),
      {
        ...rule<SeatingRule>({
          kind: 'studentInRegion',
          severity: 'required',
          studentId: 'st2',
          regionId: 'frente',
        }),
        id: 'r2',
        enabled: false,
      },
    ];
    const results = evaluateRules(rules, placement([['st1', 'c1'], ['st2', 'c2']]), context);
    expect(results).toHaveLength(1);
    expect(results[0]?.ruleId).toBe('r1');
  });
});
