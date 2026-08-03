/**
 * Score normalization (TECHNICAL_SPEC §7.3).
 *
 * Preferred rules contribute their weight; required rules do not contribute to
 * the score at all, they decide validity. A plan that breaks a required rule is
 * marked invalid and its total is pushed below any valid plan, so a high number
 * can never hide a broken constraint.
 */

import type { SeatingRule } from '../domain/types';
import type { MessageDescriptor, RuleEvaluation, SolutionScore } from './evaluation';

/** Ceiling for plans that violate at least one required rule. */
export const INVALID_PLAN_SCORE_CEILING = 49;

const MAX_EXPLANATION_ITEMS = 4;

function weightOf(rule: SeatingRule | undefined): number {
  if (!rule) return 1;
  return rule.weight > 0 ? rule.weight : 1;
}

export function scoreEvaluations(
  evaluations: readonly RuleEvaluation[],
  rules: readonly SeatingRule[],
): SolutionScore {
  const ruleById = new Map(rules.map((rule) => [rule.id, rule]));

  let requiredSatisfied = 0;
  let requiredTotal = 0;
  let preferredSatisfied = 0;
  let preferredTotal = 0;
  let satisfiedWeight = 0;
  let applicableWeight = 0;
  const violations: RuleEvaluation[] = [];

  for (const evaluation of evaluations) {
    // Rules that cannot be judged are excluded from both numerator and
    // denominator, so an unplaced student never inflates or deflates a score.
    if (evaluation.status === 'notApplicable') continue;

    const satisfied = evaluation.status === 'satisfied';
    if (!satisfied) violations.push(evaluation);

    if (evaluation.severity === 'required') {
      requiredTotal += 1;
      if (satisfied) requiredSatisfied += 1;
    } else {
      const weight = weightOf(ruleById.get(evaluation.ruleId));
      preferredTotal += 1;
      applicableWeight += weight;
      if (satisfied) {
        preferredSatisfied += 1;
        satisfiedWeight += weight;
      }
    }
  }

  const valid = requiredSatisfied === requiredTotal;
  const weightedPreferenceRatio = applicableWeight === 0 ? 1 : satisfiedWeight / applicableWeight;

  const requiredRatio = requiredTotal === 0 ? 1 : requiredSatisfied / requiredTotal;
  const total = valid
    ? Math.round(weightedPreferenceRatio * 100)
    : Math.min(
        INVALID_PLAN_SCORE_CEILING,
        Math.round(weightedPreferenceRatio * requiredRatio * INVALID_PLAN_SCORE_CEILING),
      );

  return {
    total,
    valid,
    requiredSatisfied,
    requiredTotal,
    preferredSatisfied,
    preferredTotal,
    weightedPreferenceRatio,
    violations,
    explanation: buildExplanation({
      valid,
      requiredTotal,
      requiredSatisfied,
      preferredSatisfied,
      preferredTotal,
      violations,
      ruleById,
    }),
  };
}

interface ExplanationInput {
  valid: boolean;
  requiredTotal: number;
  requiredSatisfied: number;
  preferredSatisfied: number;
  preferredTotal: number;
  violations: readonly RuleEvaluation[];
  ruleById: ReadonlyMap<string, SeatingRule>;
}

/**
 * Summarizes the trade-offs of a plan: validity first, then the preferred rules
 * it gave up on, heaviest first (PRODUCT_SPEC §5.6).
 */
function buildExplanation(input: ExplanationInput): MessageDescriptor[] {
  const messages: MessageDescriptor[] = [];

  if (input.requiredTotal > 0) {
    messages.push(
      input.valid
        ? { id: 'score.allRequiredSatisfied', values: { count: input.requiredTotal } }
        : {
            id: 'score.requiredViolated',
            values: {
              violated: input.requiredTotal - input.requiredSatisfied,
              total: input.requiredTotal,
            },
          },
    );
  }

  if (input.preferredTotal > 0) {
    messages.push({
      id: 'score.preferredSummary',
      values: { satisfied: input.preferredSatisfied, total: input.preferredTotal },
    });
  }

  const ranked = [...input.violations].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'required' ? -1 : 1;
    return weightOf(input.ruleById.get(b.ruleId)) - weightOf(input.ruleById.get(a.ruleId));
  });

  for (const violation of ranked.slice(0, MAX_EXPLANATION_ITEMS)) {
    messages.push(violation.message);
  }

  if (ranked.length > MAX_EXPLANATION_ITEMS) {
    messages.push({
      id: 'score.moreViolations',
      values: { count: ranked.length - MAX_EXPLANATION_ITEMS },
    });
  }

  return messages;
}
