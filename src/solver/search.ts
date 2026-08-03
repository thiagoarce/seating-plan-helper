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

import { evaluateRule } from '../constraints/evaluate';
import type { EvaluationContext, Placement } from '../constraints/evaluate';
import type { SeatingRule } from '../domain/types';
import type { BinaryConstraint, SolverProblem } from './problem';
import type { Rng } from './rng';

/** Guard against pathological search trees; tuned for ≤60 students. */
const MAX_BACKTRACK_NODES = 200_000;

export interface FeasibleSearchResult {
  placement: Map<string, string> | null;
  nodesVisited: boolean;
  /** How often each required rule caused a candidate to be rejected. */
  blockCounts: Map<string, number>;
}

function otherStudent(constraint: BinaryConstraint, studentId: string): string {
  return constraint.a === studentId ? constraint.b : constraint.a;
}

function binaryHolds(
  constraint: BinaryConstraint,
  studentId: string,
  seatId: string,
  otherSeatId: string,
): boolean {
  return constraint.a === studentId
    ? constraint.holds(seatId, otherSeatId)
    : constraint.holds(otherSeatId, seatId);
}

/**
 * Checks the just-proposed seat against every already-placed student that
 * shares a required relationship rule with `studentId`.
 */
function consistent(
  problem: SolverProblem,
  studentId: string,
  seatId: string,
  placement: Map<string, string>,
  blockCounts: Map<string, number>,
): boolean {
  const constraints = problem.binaryByStudent.get(studentId);
  if (!constraints) return true;

  for (const constraint of constraints) {
    const other = otherStudent(constraint, studentId);
    const otherSeat = placement.get(other) ?? problem.fixed.get(other);
    if (otherSeat === undefined) continue;
    if (!binaryHolds(constraint, studentId, seatId, otherSeat)) {
      blockCounts.set(constraint.ruleId, (blockCounts.get(constraint.ruleId) ?? 0) + 1);
      return false;
    }
  }
  return true;
}

/**
 * Forward checking: after tentatively seating `studentId`, every still-unplaced
 * student that shares a constraint with them must retain at least one legal
 * seat. Restricting the check to constraint neighbours keeps it cheap while
 * still cutting most dead branches.
 */
function forwardCheck(
  problem: SolverProblem,
  studentId: string,
  placement: Map<string, string>,
  used: Set<string>,
): boolean {
  const constraints = problem.binaryByStudent.get(studentId);
  if (!constraints) return true;

  const neighbours = new Set<string>();
  for (const constraint of constraints) {
    const other = otherStudent(constraint, studentId);
    if (!placement.has(other) && !problem.fixed.has(other)) neighbours.add(other);
  }

  for (const neighbour of neighbours) {
    const options = problem.candidates.get(neighbour) ?? [];
    let survivor = false;
    for (const candidateSeat of options) {
      if (used.has(candidateSeat)) continue;
      if (consistent(problem, neighbour, candidateSeat, placement, new Map())) {
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

      if (forwardCheck(problem, student.id, placement, used) && step(depth + 1)) return true;

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

  const constraints = problem.binaryByStudent.get(studentId);
  if (!constraints) return true;
  for (const constraint of constraints) {
    const other = otherStudent(constraint, studentId);
    const otherSeat = placement.get(other);
    if (otherSeat === undefined) continue;
    if (!binaryHolds(constraint, studentId, seatId, otherSeat)) return false;
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
