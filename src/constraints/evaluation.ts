/**
 * Types shared by rule evaluation and scoring.
 *
 * Evaluations never carry user-visible prose. They carry a message id plus
 * parameters, and the UI layer formats them through the message catalog
 * (TECHNICAL_SPEC §14). This keeps `constraints/` and `solver/` free of copy
 * and free of React.
 */

import type { RuleKind, RuleSeverity } from '../domain/types';

export interface MessageDescriptor {
  id: string;
  values?: Record<string, string | number>;
}

export type EvaluationStatus =
  /** The rule's predicate holds. */
  | 'satisfied'
  /** The rule's predicate is broken. */
  | 'violated'
  /**
   * The rule cannot be judged yet: a student it targets has no seat, or it
   * references an entity that no longer exists.
   */
  | 'notApplicable';

export interface RuleEvaluation {
  ruleId: string;
  kind: RuleKind;
  severity: RuleSeverity;
  status: EvaluationStatus;
  message: MessageDescriptor;
  /** Students whose seats should be highlighted when showing this result. */
  involvedStudentIds: string[];
  /** Seats involved, when the rule points at specific seats. */
  involvedSeatIds: string[];
}

export interface SolutionScore {
  /** 0..100. Invalid plans are capped well below valid ones. */
  total: number;
  /** True when every enabled, applicable required rule is satisfied. */
  valid: boolean;
  requiredSatisfied: number;
  requiredTotal: number;
  preferredSatisfied: number;
  preferredTotal: number;
  /** Satisfied preferred weight over total preferred weight, 0..1. */
  weightedPreferenceRatio: number;
  violations: RuleEvaluation[];
  explanation: MessageDescriptor[];
}
