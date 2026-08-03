/**
 * Feasibility search and local improvement (TECHNICAL_SPEC §7.1, steps 5-6).
 *
 * Two phases, deliberately separated:
 *
 *  1. `findFeasible` only cares about required rules. It performs randomized
 *     backtracking with forward checking and returns the first complete
 *     placement that breaks nothing, or null.
 *  2. `improve` takes a feasible placement and hill-climbs on preferred rules
 *     with simulated annealing, rejecting any move that would break a required
 *     rule. Validity is therefore an invariant of the whole phase, never
 *     something to be repaired afterwards.
 */

import { evaluateRule, studentPairs } from '../constraints/evaluate';
import type { EvaluationContext, Placement } from '../constraints/evaluate';
import type { SeatingRule } from '../domain/types';
import type { GroupConstraint, SolverProblem } from './problem';
import type { Rng } from './rng';

/** Guard against pathological search trees; tuned for ≤60 students. */
const MAX_BACKTRACK_NODES = 200_000;

export interface FeasibleSearchResult {
  placement: Map<string, string> | null;
  nodesVisited: boolean;
  /** How often each required rule caused a candidate to be rejected. */
  blockCounts: Map<string, number>;
}

/**
 * Judges a group constraint against a seat lookup. Returns `true` (cannot
 * judge yet, so never blocks a branch) until every member of the group has a
 * seat; from then on applies the constraint's `'all'`/`'any'` combination over
 * every pair (mirrors `combineGroupPredicate` in the shared evaluator).
 */
function evaluateGroupConstraint(
  constraint: GroupConstraint,
  seatOf: (studentId: string) => string | undefined,
): boolean {
  const seats = constraint.studentIds.map(seatOf);
  if (seats.some((seat) => seat === undefined)) return true;

  const pairs = studentPairs(constraint.studentIds);
  const holdsPerPair = pairs.map(([a, b]) =>
    constraint.pairHolds(seatOf(a) as string, seatOf(b) as string),
  );
  return constraint.mode === 'all' ? holdsPerPair.every(Boolean) : holdsPerPair.some(Boolean);
}

/**
 * Checks the just-proposed seat against every required group constraint
 * `studentId` participates in, treating groups still missing a member as
 * unjudgeable rather than as a violation.
 */
function consistent(
  problem: SolverProblem,
  studentId: string,
  seatId: string,
  placement: Map<string, string>,
  blockCounts: Map<string, number>,
): boolean {
  const constraints = problem.groupConstraintsByStudent.get(studentId);
  if (!constraints) return true;

  const seatOf = (id: string): string | undefined =>
    id === studentId ? seatId : (placement.get(id) ?? problem.fixed.get(id));

  for (const constraint of constraints) {
    if (!evaluateGroupConstraint(constraint, seatOf)) {
      blockCounts.set(constraint.ruleId, (blockCounts.get(constraint.ruleId) ?? 0) + 1);
      return false;
    }
  }
  return true;
}

/**
 * Forward checking: after tentatively seating `studentId`, every still-unplaced
 * student that shares a group constraint with them must retain at least one
 * legal seat. This only bites once a constraint has exactly one member left to
 * place — with more still open, `consistent` cannot judge it yet and lets the
 * candidate through, which is correct (never rejects a possibly-valid branch)
 * even though it prunes less eagerly than per-pair checking would.
 */
function forwardCheck(
  problem: SolverProblem,
  studentId: string,
  placement: Map<string, string>,
  used: Set<string>,
  blockCounts: Map<string, number>,
): boolean {
  const constraints = problem.groupConstraintsByStudent.get(studentId);
  if (!constraints) return true;

  const neighbours = new Set<string>();
  for (const constraint of constraints) {
    for (const memberId of constraint.studentIds) {
      if (memberId !== studentId && !placement.has(memberId) && !problem.fixed.has(memberId)) {
        neighbours.add(memberId);
      }
    }
  }

  for (const neighbour of neighbours) {
    const options = problem.candidates.get(neighbour) ?? [];
    let survivor = false;
    for (const candidateSeat of options) {
      if (used.has(candidateSeat)) continue;
      // Shares the real accumulator: with group (as opposed to per-pair)
      // constraints, a rejection is sometimes only detectable here — once
      // enough of the group is tentatively seated to judge it — rather than
      // at the top-level `consistent` call for the student being placed.
      if (consistent(problem, neighbour, candidateSeat, placement, blockCounts)) {
        survivor = true;
        break;
      }
    }
    if (!survivor) return false;
  }
  return true;
}

export function findFeasible(
  problem: SolverProblem,
  rng: Rng,
  isExpired: () => boolean,
): FeasibleSearchResult {
  const placement = new Map<string, string>();
  const used = new Set(problem.fixedSeatIds);
  const blockCounts = new Map<string, number>();
  const order = problem.freeStudents;
  let nodes = 0;
  let expired = false;

  const step = (depth: number): boolean => {
    if (depth === order.length) return true;
    if (expired) return false;

    nodes += 1;
    if (nodes > MAX_BACKTRACK_NODES || (nodes % 512 === 0 && isExpired())) {
      expired = true;
      return false;
    }

    const student = order[depth];
    if (!student) return true;

    const options = rng.shuffle(problem.candidates.get(student.id) ?? []);
    for (const seatId of options) {
      if (used.has(seatId)) continue;
      if (!consistent(problem, student.id, seatId, placement, blockCounts)) continue;

      placement.set(student.id, seatId);
      used.add(seatId);

      if (forwardCheck(problem, student.id, placement, used, blockCounts) && step(depth + 1)) {
        return true;
      }

      placement.delete(student.id);
      used.delete(seatId);
    }
    return false;
  };

  const solved = step(0);
  return {
    placement: solved ? new Map([...problem.fixed, ...placement]) : null,
    nodesVisited: nodes > 0,
    blockCounts,
  };
}

// ---------------------------------------------------------------------------
// Local improvement
// ---------------------------------------------------------------------------

const ANNEALING_START_TEMPERATURE = 0.25;
const ANNEALING_END_TEMPERATURE = 0.002;

interface PreferredState {
  /** Enabled preferred rules that can actually be judged for this room. */
  rules: SeatingRule[];
  rulesByStudent: Map<string, SeatingRule[]>;
  satisfied: Map<string, boolean>;
  weights: Map<string, number>;
  satisfiedWeight: number;
  applicableWeight: number;
}

function ruleStudents(rule: SeatingRule): string[] {
  return 'studentIds' in rule ? rule.studentIds : [rule.studentId];
}

function buildPreferredState(
  problem: SolverProblem,
  placement: Placement,
  context: EvaluationContext,
): PreferredState {
  const rules = problem.rules.filter(
    (rule) => rule.enabled && rule.severity === 'preferred',
  );
  const rulesByStudent = new Map<string, SeatingRule[]>();
  const satisfied = new Map<string, boolean>();
  const weights = new Map<string, number>();
  let satisfiedWeight = 0;
  let applicableWeight = 0;

  for (const rule of rules) {
    const evaluation = evaluateRule(rule, placement, context);
    if (evaluation.status === 'notApplicable') continue;

    const weight = rule.weight > 0 ? rule.weight : 1;
    weights.set(rule.id, weight);
    applicableWeight += weight;
    const isSatisfied = evaluation.status === 'satisfied';
    satisfied.set(rule.id, isSatisfied);
    if (isSatisfied) satisfiedWeight += weight;

    for (const studentId of ruleStudents(rule)) {
      const list = rulesByStudent.get(studentId);
      if (list) list.push(rule);
      else rulesByStudent.set(studentId, [rule]);
    }
  }

  return {
    rules,
    rulesByStudent,
    satisfied,
    weights,
    satisfiedWeight,
    applicableWeight,
  };
}

/** Required rules touching `studentId` still hold for the proposed placement. */
function requiredHoldsFor(
  problem: SolverProblem,
  studentId: string,
  placement: Map<string, string>,
): boolean {
  const seatId = placement.get(studentId);
  if (seatId === undefined) return false;

  const allowed = problem.candidates.get(studentId);
  // Fixed students keep their seat; free students must stay inside the seats
  // their unary required rules allow.
  if (allowed !== undefined && !allowed.includes(seatId)) return false;

  const constraints = problem.groupConstraintsByStudent.get(studentId);
  if (!constraints) return true;

  const seatOf = (id: string): string | undefined => placement.get(id) ?? problem.fixed.get(id);
  for (const constraint of constraints) {
    if (!evaluateGroupConstraint(constraint, seatOf)) return false;
  }
  return true;
}

export interface ImproveResult {
  placement: Map<string, string>;
  weightedPreferenceRatio: number;
}

/**
 * Simulated annealing over student moves and swaps. Only free students move;
 * locked and fixed-seat students are never touched, which is what makes
 * "regenerate the unlocked seats" safe.
 */
export function improve(
  problem: SolverProblem,
  feasible: Map<string, string>,
  rng: Rng,
  isExpired: () => boolean,
  iterations: number,
): ImproveResult {
  const context: EvaluationContext = {
    index: problem.index,
    studentNameById: problem.studentNameById,
  };

  const placement = new Map(feasible);
  const state = buildPreferredState(problem, placement, context);

  if (state.applicableWeight === 0 || problem.freeStudents.length < 2) {
    return {
      placement,
      weightedPreferenceRatio: state.applicableWeight === 0 ? 1 : state.satisfiedWeight / state.applicableWeight,
    };
  }

  const seatOwner = new Map<string, string>();
  for (const [studentId, seatId] of placement) seatOwner.set(seatId, studentId);

  const freeIds = problem.freeStudents.map((student) => student.id);
  const freeSet = new Set(freeIds);

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    if (iteration % 256 === 0 && isExpired()) break;

    const progress = iteration / iterations;
    const temperature =
      ANNEALING_START_TEMPERATURE *
      Math.pow(ANNEALING_END_TEMPERATURE / ANNEALING_START_TEMPERATURE, progress);

    const studentA = rng.pick(freeIds);
    if (!studentA) break;
    const seatA = placement.get(studentA);
    if (seatA === undefined) continue;

    const targets = problem.candidates.get(studentA) ?? [];
    const seatB = rng.pick(targets);
    if (seatB === undefined || seatB === seatA) continue;

    const studentB = seatOwner.get(seatB);
    // Never displace a locked or fixed-seat student.
    if (studentB !== undefined && !freeSet.has(studentB)) continue;
    if (studentB !== undefined && !(problem.candidates.get(studentB) ?? []).includes(seatA)) {
      continue;
    }

    // Apply tentatively.
    placement.set(studentA, seatB);
    if (studentB !== undefined) placement.set(studentB, seatA);

    const touched = studentB === undefined ? [studentA] : [studentA, studentB];
    let requiredOk = true;
    for (const studentId of touched) {
      if (!requiredHoldsFor(problem, studentId, placement)) {
        requiredOk = false;
        break;
      }
    }
    // A move can also break a rule between an untouched pair only if one of the
    // touched students participates, so checking their constraint lists is
    // sufficient.

    if (!requiredOk) {
      placement.set(studentA, seatA);
      if (studentB !== undefined) placement.set(studentB, seatB);
      continue;
    }

    const affected = new Set<SeatingRule>();
    for (const studentId of touched) {
      for (const rule of state.rulesByStudent.get(studentId) ?? []) affected.add(rule);
    }

    let delta = 0;
    const updates: Array<[string, boolean]> = [];
    for (const rule of affected) {
      const weight = state.weights.get(rule.id);
      if (weight === undefined) continue;
      const before = state.satisfied.get(rule.id) ?? false;
      const after = evaluateRule(rule, placement, context).status === 'satisfied';
      if (before !== after) {
        delta += after ? weight : -weight;
        updates.push([rule.id, after]);
      }
    }

    const normalizedDelta = delta / state.applicableWeight;
    const accept =
      normalizedDelta >= 0 || rng.next() < Math.exp(normalizedDelta / Math.max(temperature, 1e-6));

    if (accept) {
      for (const [ruleId, value] of updates) state.satisfied.set(ruleId, value);
      state.satisfiedWeight += delta;
      seatOwner.set(seatB, studentA);
      if (studentB === undefined) seatOwner.delete(seatA);
      else seatOwner.set(seatA, studentB);
    } else {
      placement.set(studentA, seatA);
      if (studentB !== undefined) placement.set(studentB, seatB);
    }
  }

  return {
    placement,
    weightedPreferenceRatio: state.satisfiedWeight / state.applicableWeight,
  };
}
