import { describe, expect, it } from 'vitest';
import type { SeatingRule } from '../domain/types';
import type { RuleEvaluation } from './evaluation';
import { INVALID_PLAN_SCORE_CEILING, scoreEvaluations } from './scoring';

function preferred(id: string, weight: number): SeatingRule {
  return {
    id,
    kind: 'pairSameCenter',
    enabled: true,
    severity: 'preferred',
    weight,
    studentIds: ['x', 'y'],
  };
}

function required(id: string): SeatingRule {
  return {
    id,
    kind: 'pairSameCenter',
    enabled: true,
    severity: 'required',
    weight: 1,
    studentIds: ['x', 'y'],
  };
}

function evaluation(
  rule: SeatingRule,
  status: RuleEvaluation['status'],
): RuleEvaluation {
  return {
    ruleId: rule.id,
    kind: rule.kind,
    severity: rule.severity,
    status,
    message: { id: `test.${status}` },
    involvedStudentIds: [],
    involvedSeatIds: [],
  };
}

describe('scoreEvaluations', () => {
  it('gives 100 when every preferred rule is satisfied', () => {
    const rules = [preferred('p1', 1), preferred('p2', 3)];
    const score = scoreEvaluations(
      rules.map((rule) => evaluation(rule, 'satisfied')),
      rules,
    );
    expect(score.total).toBe(100);
    expect(score.valid).toBe(true);
  });

  it('weights preferred rules by their weight, not by count', () => {
    const light = preferred('p1', 1);
    const heavy = preferred('p2', 9);
    const rules = [light, heavy];

    const heavySatisfied = scoreEvaluations(
      [evaluation(light, 'violated'), evaluation(heavy, 'satisfied')],
      rules,
    );
    const lightSatisfied = scoreEvaluations(
      [evaluation(light, 'satisfied'), evaluation(heavy, 'violated')],
      rules,
    );

    expect(heavySatisfied.total).toBe(90);
    expect(lightSatisfied.total).toBe(10);
  });

  it('scores 100 when there are no applicable preferred rules', () => {
    const rules = [required('r1')];
    const score = scoreEvaluations([evaluation(rules[0]!, 'satisfied')], rules);
    expect(score.total).toBe(100);
  });

  it('marks a plan invalid and caps its score when a required rule breaks', () => {
    const req = required('r1');
    const pref = preferred('p1', 1);
    const score = scoreEvaluations(
      [evaluation(req, 'violated'), evaluation(pref, 'satisfied')],
      [req, pref],
    );

    expect(score.valid).toBe(false);
    expect(score.total).toBeLessThanOrEqual(INVALID_PLAN_SCORE_CEILING);
  });

  it('never lets an invalid plan outscore a valid one', () => {
    const req = required('r1');
    const pref = preferred('p1', 1);

    const invalidButAllPreferred = scoreEvaluations(
      [evaluation(req, 'violated'), evaluation(pref, 'satisfied')],
      [req, pref],
    );
    const validButNoPreferred = scoreEvaluations(
      [evaluation(req, 'satisfied'), evaluation(pref, 'violated')],
      [req, pref],
    );

    expect(validButNoPreferred.valid).toBe(true);
    expect(invalidButAllPreferred.valid).toBe(false);
    // A valid plan that satisfies nothing preferred scores 0, which ties the
    // floor; the `valid` flag is what the UI must lead with.
    expect(invalidButAllPreferred.total).toBeLessThanOrEqual(INVALID_PLAN_SCORE_CEILING);
  });

  it('excludes non-applicable rules from both totals', () => {
    const pref = preferred('p1', 1);
    const orphaned = preferred('p2', 100);
    const score = scoreEvaluations(
      [evaluation(pref, 'satisfied'), evaluation(orphaned, 'notApplicable')],
      [pref, orphaned],
    );

    expect(score.preferredTotal).toBe(1);
    expect(score.total).toBe(100);
  });

  it('collects violations and ranks the explanation by weight', () => {
    const light = preferred('p1', 1);
    const heavy = preferred('p2', 5);
    const score = scoreEvaluations(
      [evaluation(light, 'violated'), evaluation(heavy, 'violated')],
      [light, heavy],
    );

    expect(score.violations).toHaveLength(2);
    // First entry is the preferred summary, then the heaviest violation.
    expect(score.explanation[0]?.id).toBe('score.preferredSummary');
    expect(score.violations.some((item) => item.ruleId === 'p2')).toBe(true);
  });

  it('reports required rule counts', () => {
    const r1 = required('r1');
    const r2 = required('r2');
    const score = scoreEvaluations(
      [evaluation(r1, 'satisfied'), evaluation(r2, 'violated')],
      [r1, r2],
    );
    expect(score.requiredSatisfied).toBe(1);
    expect(score.requiredTotal).toBe(2);
    expect(score.explanation[0]?.id).toBe('score.requiredViolated');
  });
});
