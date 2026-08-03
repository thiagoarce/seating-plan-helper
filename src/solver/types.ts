/**
 * Public shape of a generation run (PRODUCT_SPEC §5.6, TECHNICAL_SPEC §7).
 */

import type { MessageDescriptor, SolutionScore } from '../constraints/evaluation';
import type { SeatAssignment } from '../domain/types';

export interface SeatingSuggestion {
  id: string;
  /** The seed that produced this plan, so it can be reproduced. */
  seed: number;
  assignments: SeatAssignment[];
  score: SolutionScore;
}

export interface GenerationResult {
  suggestions: SeatingSuggestion[];
  /** True when at least one returned plan satisfies every required rule. */
  foundValid: boolean;
  /** Reasons the problem may be unsolvable, detected before searching. */
  blockers: MessageDescriptor[];
  /** Non-fatal remarks, e.g. fewer than three distinct plans were found. */
  notes: MessageDescriptor[];
  attemptsRun: number;
  elapsedMs: number;
  /** Rules that most often caused a candidate to be rejected. */
  frequentBlockingRuleIds: string[];
}

export interface GenerationProgress {
  attemptsRun: number;
  attemptsTotal: number;
  bestScore: number | null;
  foundValid: boolean;
}

export interface SolveOptions {
  /** Called periodically so the UI can show progress. */
  onProgress?: (progress: GenerationProgress) => void;
  /** Polled between attempts; returning true stops the run early. */
  shouldCancel?: () => boolean;
  /** Overrides the project seed. */
  seed?: number;
  /** Injectable clock, used by tests to make deadlines deterministic. */
  now?: () => number;
}
