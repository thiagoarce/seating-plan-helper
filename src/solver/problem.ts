/**
 * Turns a project into the compact form the search operates on
 * (TECHNICAL_SPEC §7.1, steps 1-4).
 *
 * Required rules become predicates:
 *  - unary constraints prune each student's candidate seat list up front;
 *  - group constraints are checked once every student they involve has a
 *    seat, whether tentative (during backtracking) or final.
 *
 * Preferred rules are not compiled here. They are scored through the shared
 * evaluator so that "valid" and "scored" always mean the same thing in the
 * solver and in the editor.
 */

import type { MessageDescriptor } from '../constraints/evaluation';
import type { RoomIndex } from '../domain/room';
import { buildRoomIndex } from '../domain/room';
import type {
  GenerationSettings,
  GroupMode,
  SeatAssignment,
  SeatingProject,
  SeatingRule,
  Student,
} from '../domain/types';

export interface UnaryConstraint {
  ruleId: string;
  studentId: string;
  allows: (seatId: string) => boolean;
}

/**
 * A required relationship rule over a `studentIds` set, compiled to a single
 * pairwise predicate plus how to combine it across the group (§ `GroupMode`).
 *
 * This is checked as one unit once every member of `studentIds` has a seat
 * (tentative or fixed), rather than decomposed into independent per-pair
 * constraints — that decomposition would silently force `'all'` semantics on
 * an `'any'` rule, since each pair would be pruned as mandatory on its own.
 */
export interface GroupConstraint {
  ruleId: string;
  studentIds: readonly string[];
  mode: GroupMode;
  pairHolds: (seatA: string, seatB: string) => boolean;
}

export interface SolverProblem {
  index: RoomIndex;
  settings: GenerationSettings;
  students: Student[];
  studentNameById: Map<string, string>;
  rules: SeatingRule[];
  /** Assignments the search must keep exactly as they are. */
  fixed: Map<string, string>;
  /** Seat ids consumed by fixed assignments. */
  fixedSeatIds: Set<string>;
  /**
   * Students held in place by an explicit user lock, as opposed to a
   * fixed-seat rule. Only these keep `locked: true` in the produced plans.
   */
  lockedStudentIds: Set<string>;
  /** Students the search must place, ordered most-constrained first. */
  freeStudents: Student[];
  /** Candidate seats per free student, after unary pruning. */
  candidates: Map<string, string[]>;
  /** Required group constraints indexed by each participating student. */
  groupConstraintsByStudent: Map<string, GroupConstraint[]>;
  /** Problems detected before the search even starts. */
  blockers: MessageDescriptor[];
}

function buildUnaryConstraints(
  rules: readonly SeatingRule[],
  index: RoomIndex,
): UnaryConstraint[] {
  const constraints: UnaryConstraint[] = [];

  for (const rule of rules) {
    if (!rule.enabled || rule.severity !== 'required') continue;

    switch (rule.kind) {
      case 'studentInRegion': {
        if (!index.room.regions.some((region) => region.id === rule.regionId)) break;
        constraints.push({
          ruleId: rule.id,
          studentId: rule.studentId,
          allows: (seatId) => index.seatById.get(seatId)?.regionIds.has(rule.regionId) ?? false,
        });
        break;
      }
      case 'studentNotInRegion': {
        if (!index.room.regions.some((region) => region.id === rule.regionId)) break;
        constraints.push({
          ruleId: rule.id,
          studentId: rule.studentId,
          allows: (seatId) => !(index.seatById.get(seatId)?.regionIds.has(rule.regionId) ?? false),
        });
        break;
      }
      case 'studentNearObject': {
        if (!index.objectById.has(rule.objectId)) break;
        constraints.push({
          ruleId: rule.id,
          studentId: rule.studentId,
          allows: (seatId) => {
            const measured = index.seatById.get(seatId)?.objectDistances.get(rule.objectId);
            return measured !== undefined && measured <= rule.maxDistance;
          },
        });
        break;
      }
      case 'studentFarFromObject': {
        if (!index.objectById.has(rule.objectId)) break;
        constraints.push({
          ruleId: rule.id,
          studentId: rule.studentId,
          allows: (seatId) => {
            const measured = index.seatById.get(seatId)?.objectDistances.get(rule.objectId);
            return measured !== undefined && measured >= rule.minDistance;
          },
        });
        break;
      }
      case 'studentFixedSeat': {
        if (!index.seatById.has(rule.seatId)) break;
        constraints.push({
          ruleId: rule.id,
          studentId: rule.studentId,
          allows: (seatId) => seatId === rule.seatId,
        });
        break;
      }
      default:
        break;
    }
  }

  return constraints;
}

/**
 * Compiles each required relationship rule into one `GroupConstraint`. Kept
 * as a single unit per rule (not one per pair) so `'any'` mode — satisfied by
 * a single pair — cannot be accidentally tightened into `'all'` by pruning
 * each pair independently.
 */
function buildGroupConstraints(
  rules: readonly SeatingRule[],
  index: RoomIndex,
): GroupConstraint[] {
  const constraints: GroupConstraint[] = [];

  for (const rule of rules) {
    if (!rule.enabled || rule.severity !== 'required') continue;

    let pairHolds: ((seatA: string, seatB: string) => boolean) | null = null;
    let studentIds: readonly string[] = [];
    let mode: GroupMode = 'any';

    switch (rule.kind) {
      case 'pairSameCenter':
        studentIds = rule.studentIds;
        mode = rule.groupMode ?? 'any';
        pairHolds = (seatA, seatB) =>
          index.seatById.get(seatA)?.center.id === index.seatById.get(seatB)?.center.id;
        break;
      case 'pairDifferentCenter':
        studentIds = rule.studentIds;
        mode = rule.groupMode ?? 'any';
        pairHolds = (seatA, seatB) =>
          index.seatById.get(seatA)?.center.id !== index.seatById.get(seatB)?.center.id;
        break;
      case 'pairNotAdjacentCenters':
        studentIds = rule.studentIds;
        mode = rule.groupMode ?? 'any';
        pairHolds = (seatA, seatB) => {
          const centerA = index.seatById.get(seatA)?.center.id;
          const centerB = index.seatById.get(seatB)?.center.id;
          if (!centerA || !centerB) return false;
          if (centerA === centerB) return false;
          return !(index.adjacentCenterIds.get(centerA)?.has(centerB) ?? false);
        };
        break;
      case 'pairNear':
        studentIds = rule.studentIds;
        mode = rule.groupMode ?? 'any';
        pairHolds = (seatA, seatB) => index.seatDistance(seatA, seatB) <= rule.maxDistance;
        break;
      case 'pairFar':
      case 'pairMinimumDistance':
        studentIds = rule.studentIds;
        mode = rule.groupMode ?? 'any';
        pairHolds = (seatA, seatB) => index.seatDistance(seatA, seatB) >= rule.minDistance;
        break;
      default:
        pairHolds = null;
    }

    if (!pairHolds || studentIds.length < 2) continue;

    constraints.push({ ruleId: rule.id, studentIds, mode, pairHolds });
  }

  return constraints;
}

export interface BuildProblemOptions {
  /**
   * Assignments to keep. Defaults to the project's locked assignments, which is
   * what "regenerate the rest" uses (PRODUCT_SPEC §5.6).
   */
  keepAssignments?: readonly SeatAssignment[];
}

export function buildProblem(
  project: SeatingProject,
  options: BuildProblemOptions = {},
): SolverProblem {
  const settings = project.generation;
  const index = buildRoomIndex(project.room, settings.adjacentCenterDistance);
  const studentNameById = new Map(project.roster.map((student) => [student.id, student.name]));
  const blockers: MessageDescriptor[] = [];

  const keep = options.keepAssignments ?? project.assignments.filter((item) => item.locked);

  const fixed = new Map<string, string>();
  const fixedSeatIds = new Set<string>();
  const lockedStudentIds = new Set<string>();
  const seatOwner = new Map<string, string>();

  const claimSeat = (studentId: string, seatId: string, source: 'lock' | 'rule'): void => {
    if (!index.seatById.has(seatId) || !studentNameById.has(studentId)) return;
    const existing = seatOwner.get(seatId);
    if (existing !== undefined && existing !== studentId) {
      blockers.push({
        id: 'solver.blocker.seatConflict',
        values: {
          seat: seatId,
          students: `${studentNameById.get(existing) ?? existing}, ${
            studentNameById.get(studentId) ?? studentId
          }`,
        },
      });
      return;
    }
    const previousSeat = fixed.get(studentId);
    if (previousSeat !== undefined && previousSeat !== seatId) {
      blockers.push({
        id: 'solver.blocker.studentTwoSeats',
        values: { student: studentNameById.get(studentId) ?? studentId },
      });
      return;
    }
    fixed.set(studentId, seatId);
    fixedSeatIds.add(seatId);
    seatOwner.set(seatId, studentId);
    if (source === 'lock') lockedStudentIds.add(studentId);
  };

  for (const assignment of keep) {
    claimSeat(assignment.studentId, assignment.seatId, 'lock');
  }

  // A required fixed-seat rule is as binding as an explicit lock.
  for (const rule of project.rules) {
    if (rule.enabled && rule.severity === 'required' && rule.kind === 'studentFixedSeat') {
      claimSeat(rule.studentId, rule.seatId, 'rule');
    }
  }

  const unary = buildUnaryConstraints(project.rules, index);
  const unaryByStudent = new Map<string, UnaryConstraint[]>();
  for (const constraint of unary) {
    const list = unaryByStudent.get(constraint.studentId);
    if (list) list.push(constraint);
    else unaryByStudent.set(constraint.studentId, [constraint]);
  }

  const availableSeatIds = index.seats
    .map((seat) => seat.seat.id)
    .filter((seatId) => !fixedSeatIds.has(seatId));

  const freeStudents = project.roster.filter((student) => !fixed.has(student.id));
  const candidates = new Map<string, string[]>();

  for (const student of freeStudents) {
    const constraints = unaryByStudent.get(student.id) ?? [];
    const allowed = availableSeatIds.filter((seatId) =>
      constraints.every((constraint) => constraint.allows(seatId)),
    );
    candidates.set(student.id, allowed);
    if (allowed.length === 0) {
      blockers.push({
        id: 'solver.blocker.noCandidateSeats',
        values: { student: student.name },
      });
    }
  }

  const groupConstraintsByStudent = new Map<string, GroupConstraint[]>();
  for (const constraint of buildGroupConstraints(project.rules, index)) {
    if (!constraint.studentIds.every((id) => studentNameById.has(id))) continue;
    for (const studentId of constraint.studentIds) {
      const list = groupConstraintsByStudent.get(studentId);
      if (list) list.push(constraint);
      else groupConstraintsByStudent.set(studentId, [constraint]);
    }
  }

  // Most-constrained-first: fewest candidates, then most group constraints.
  const ordered = [...freeStudents].sort((left, right) => {
    const byCandidates =
      (candidates.get(left.id)?.length ?? 0) - (candidates.get(right.id)?.length ?? 0);
    if (byCandidates !== 0) return byCandidates;
    return (
      (groupConstraintsByStudent.get(right.id)?.length ?? 0) -
      (groupConstraintsByStudent.get(left.id)?.length ?? 0)
    );
  });

  if (project.roster.length > index.seats.length) {
    blockers.push({
      id: 'solver.blocker.notEnoughSeats',
      values: { students: project.roster.length, seats: index.seats.length },
    });
  }

  return {
    index,
    settings,
    students: project.roster,
    studentNameById,
    rules: project.rules,
    fixed,
    fixedSeatIds,
    lockedStudentIds,
    freeStudents: ordered,
    candidates,
    groupConstraintsByStudent,
    blockers,
  };
}
