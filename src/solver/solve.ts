/**
 * Generation orchestration (TECHNICAL_SPEC §7.1, steps 7-9).
 *
 * Runs several seeded attempts, scores each result through the shared
 * evaluator, then returns the best three plans that are meaningfully different
 * from one another. Nothing here relaxes a required rule: if no valid plan is
 * found, the result says so and the best-effort plans it returns are marked
 * invalid by their own score.
 *
 * The run is exposed one attempt at a time (`createRun`) as well as as a single
 * blocking call (`solve`). A worker uses the incremental form so it can return
 * to its message loop between attempts and actually observe a cancellation;
 * tests and non-worker fallbacks use the blocking form.
 */

import { evaluateRules } from '../constraints/evaluate';
import type { EvaluationContext, Placement } from '../constraints/evaluate';
import type { MessageDescriptor } from '../constraints/evaluation';
import { scoreEvaluations } from '../constraints/scoring';
import type { SeatAssignment, SeatingProject } from '../domain/types';
import { createId } from '../shared/id';
import { buildProblem } from './problem';
import type { BuildProblemOptions, SolverProblem } from './problem';
import { createRng, randomSeed } from './rng';
import { findFeasible, improve } from './search';
import type { GenerationResult, SeatingSuggestion, SolveOptions } from './types';

export const MAX_SUGGESTIONS = 3;

/** Blockers that make the problem unsolvable as stated. */
const FATAL_BLOCKER_IDS = new Set([
  'solver.blocker.notEnoughSeats',
  'solver.blocker.noCandidateSeats',
  'solver.blocker.seatConflict',
  'solver.blocker.studentTwoSeats',
]);

/** Annealing iterations per attempt, scaled by problem size. */
function iterationBudget(problem: SolverProblem): number {
  const students = Math.max(problem.freeStudents.length, 1);
  return Math.min(20_000, Math.max(1_500, students * 250));
}

/**
 * Fraction of students seated differently in two plans (TECHNICAL_SPEC §7.4).
 * 0 means identical, 1 means nobody kept their seat.
 */
export function planDistance(left: Placement, right: Placement): number {
  const studentIds = new Set([...left.keys(), ...right.keys()]);
  if (studentIds.size === 0) return 0;
  let different = 0;
  for (const studentId of studentIds) {
    if (left.get(studentId) !== right.get(studentId)) different += 1;
  }
  return different / studentIds.size;
}

function toAssignments(
  placement: Placement,
  lockedStudentIds: ReadonlySet<string>,
): SeatAssignment[] {
  return [...placement.entries()]
    .map(([studentId, seatId]) => ({
      studentId,
      seatId,
      locked: lockedStudentIds.has(studentId),
    }))
    .sort((a, b) => a.studentId.localeCompare(b.studentId));
}

interface Candidate {
  placement: Map<string, string>;
  suggestion: SeatingSuggestion;
}

/**
 * Greedily picks the highest-scoring plans that differ enough from the ones
 * already picked. Valid plans always outrank invalid ones.
 */
function selectDiverse(
  candidates: readonly Candidate[],
  diversityThreshold: number,
): { chosen: Candidate[]; relaxedDiversity: boolean } {
  const ranked = [...candidates].sort((a, b) => {
    if (a.suggestion.score.valid !== b.suggestion.score.valid) {
      return a.suggestion.score.valid ? -1 : 1;
    }
    return b.suggestion.score.total - a.suggestion.score.total;
  });

  const chosen: Candidate[] = [];
  for (const candidate of ranked) {
    if (chosen.length >= MAX_SUGGESTIONS) break;
    const distinct = chosen.every(
      (picked) => planDistance(picked.placement, candidate.placement) >= diversityThreshold,
    );
    if (distinct) chosen.push(candidate);
  }

  // When the constraints are tight enough that only near-duplicates exist we
  // still return the best plan, but say that diversity had to be given up
  // rather than padding the list silently.
  let relaxedDiversity = false;
  if (chosen.length === 0 && ranked.length > 0) {
    const first = ranked[0];
    if (first) {
      chosen.push(first);
      relaxedDiversity = true;
    }
  }

  return { chosen, relaxedDiversity };
}

export interface SolveInput extends BuildProblemOptions, SolveOptions {}

export interface SolverRun {
  /**
   * Runs one seeded attempt. Returns false when the run is finished, whether
   * because the attempt budget is spent, the time budget expired, or the
   * problem was rejected up front.
   */
  step: () => boolean;
  /** Snapshot of the result so far; safe to call at any point. */
  result: () => GenerationResult;
  attemptsTotal: number;
}

export function createRun(project: SeatingProject, input: SolveInput = {}): SolverRun {
  const now = input.now ?? (() => Date.now());
  const startedAt = now();

  const problem = buildProblem(project, { keepAssignments: input.keepAssignments });
  const context: EvaluationContext = {
    index: problem.index,
    studentNameById: problem.studentNameById,
  };

  const hasFatalBlocker = problem.blockers.some((blocker) => FATAL_BLOCKER_IDS.has(blocker.id));
  const deadline = startedAt + problem.settings.timeBudgetMs;
  const isExpired = (): boolean => now() >= deadline;

  const baseSeed = input.seed ?? project.generation.seed ?? randomSeed();
  const attemptsTotal = hasFatalBlocker ? 0 : problem.settings.attempts;
  const iterations = iterationBudget(problem);

  const candidates: Candidate[] = [];
  const blockCounts = new Map<string, number>();
  let attemptIndex = 0;
  let attemptsRun = 0;
  let bestScore: number | null = null;
  let foundValid = false;
  let stopped = hasFatalBlocker;

  const step = (): boolean => {
    if (stopped || attemptIndex >= attemptsTotal) return false;
    if (input.shouldCancel?.() === true) {
      stopped = true;
      return false;
    }
    // Once at least one plan exists, the time budget ends the run; before that
    // we let the current attempt finish so a hard problem still returns
    // something.
    if (isExpired() && candidates.length > 0) {
      stopped = true;
      return false;
    }

    const seed = (baseSeed + attemptIndex * 0x9e3779b1) >>> 0;
    attemptIndex += 1;
    attemptsRun += 1;
    const rng = createRng(seed);

    const feasible = findFeasible(problem, rng, isExpired);
    for (const [ruleId, count] of feasible.blockCounts) {
      blockCounts.set(ruleId, (blockCounts.get(ruleId) ?? 0) + count);
    }

    if (feasible.placement) {
      const improved = improve(problem, feasible.placement, rng, isExpired, iterations);
      const evaluations = evaluateRules(project.rules, improved.placement, context);
      const score = scoreEvaluations(evaluations, project.rules);

      candidates.push({
        placement: improved.placement,
        suggestion: {
          id: createId('plan'),
          seed,
          assignments: toAssignments(improved.placement, problem.lockedStudentIds),
          score,
        },
      });

      if (score.valid) foundValid = true;
      bestScore = bestScore === null ? score.total : Math.max(bestScore, score.total);
    }

    input.onProgress?.({ attemptsRun, attemptsTotal, bestScore, foundValid });

    if (isExpired()) {
      stopped = true;
      return false;
    }
    return attemptIndex < attemptsTotal;
  };

  const result = (): GenerationResult => {
    const { chosen, relaxedDiversity } = selectDiverse(
      candidates,
      problem.settings.diversityThreshold,
    );

    const notes: MessageDescriptor[] = [];
    if (candidates.length === 0 && !hasFatalBlocker) {
      notes.push({ id: 'solver.note.noFeasiblePlan' });
    } else if (chosen.length > 0 && chosen.length < MAX_SUGGESTIONS) {
      notes.push({
        id: 'solver.note.fewDistinctPlans',
        values: { count: chosen.length, requested: MAX_SUGGESTIONS },
      });
    }
    if (relaxedDiversity) notes.push({ id: 'solver.note.diversityRelaxed' });
    if (!foundValid && candidates.length > 0) notes.push({ id: 'solver.note.bestEffortOnly' });

    const frequentBlockingRuleIds = [...blockCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([ruleId]) => ruleId);

    return {
      suggestions: chosen.map((candidate) => candidate.suggestion),
      foundValid,
      blockers: problem.blockers,
      notes,
      attemptsRun,
      elapsedMs: now() - startedAt,
      frequentBlockingRuleIds,
    };
  };

  return { step, result, attemptsTotal };
}

/** Drives a run to completion on the current thread. */
export function solve(project: SeatingProject, input: SolveInput = {}): GenerationResult {
  const run = createRun(project, input);
  while (run.step()) {
    // Each call performs one seeded attempt.
  }
  return run.result();
}
