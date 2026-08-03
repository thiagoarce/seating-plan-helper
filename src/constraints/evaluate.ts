/**
 * Rule evaluation (PRODUCT_SPEC §5.5, TECHNICAL_SPEC §5).
 *
 * Every rule kind has exactly one evaluator here, and both the live editor
 * feedback and the solver's scoring go through it. There is no second,
 * "approximate" implementation inside the solver: a plan the solver calls valid
 * is valid by the same code the UI uses.
 */

import type { RoomIndex } from '../domain/room';
import type { PairRule, SeatingRule } from '../domain/types';
import type { MessageDescriptor, RuleEvaluation } from './evaluation';

/** studentId -> seatId. Students absent from the map are unassigned. */
export type Placement = ReadonlyMap<string, string>;

export interface EvaluationContext {
  index: RoomIndex;
  /** Used only to resolve display names in messages. */
  studentNameById: ReadonlyMap<string, string>;
}

function nameOf(context: EvaluationContext, studentId: string): string {
  return context.studentNameById.get(studentId) ?? studentId;
}

function namesOf(context: EvaluationContext, studentIds: readonly string[]): string {
  return studentIds.map((id) => nameOf(context, id)).join(', ');
}

/** Every unordered pair of a student set, in stable order. */
export function studentPairs(studentIds: readonly string[]): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < studentIds.length; i += 1) {
    for (let j = i + 1; j < studentIds.length; j += 1) {
      const a = studentIds[i];
      const b = studentIds[j];
      if (a && b && a !== b) pairs.push([a, b]);
    }
  }
  return pairs;
}

function result(
  rule: SeatingRule,
  status: RuleEvaluation['status'],
  message: MessageDescriptor,
  involvedStudentIds: string[],
  involvedSeatIds: string[] = [],
): RuleEvaluation {
  return {
    ruleId: rule.id,
    kind: rule.kind,
    severity: rule.severity,
    status,
    message,
    involvedStudentIds,
    involvedSeatIds,
  };
}

function orphan(rule: SeatingRule, messageId: string, students: string[]): RuleEvaluation {
  return result(rule, 'notApplicable', { id: messageId }, students);
}

function unassigned(rule: SeatingRule, students: string[]): RuleEvaluation {
  return result(rule, 'notApplicable', { id: 'rule.status.unassigned' }, students);
}

/**
 * Resolves the seats of every student a relationship rule targets. Returns null
 * when any of them is unassigned, because the predicate cannot be judged yet.
 */
function seatsForPairRule(
  rule: PairRule,
  placement: Placement,
): Array<{ studentId: string; seatId: string }> | null {
  const seats: Array<{ studentId: string; seatId: string }> = [];
  for (const studentId of rule.studentIds) {
    const seatId = placement.get(studentId);
    if (seatId === undefined) return null;
    seats.push({ studentId, seatId });
  }
  return seats;
}

// ---------------------------------------------------------------------------
// Single-student rules
// ---------------------------------------------------------------------------

function evaluateStudentRule(
  rule: Extract<SeatingRule, { studentId: string }>,
  placement: Placement,
  context: EvaluationContext,
): RuleEvaluation {
  const students = [rule.studentId];
  const studentName = nameOf(context, rule.studentId);
  const seatId = placement.get(rule.studentId);

  // A fixed-seat rule is about the seat itself, so a missing seat is an orphan
  // reference even before the student is placed.
  if (rule.kind === 'studentFixedSeat') {
    const target = context.index.seatById.get(rule.seatId);
    if (!target) return orphan(rule, 'rule.orphan.seat', students);
    if (seatId === undefined) return unassigned(rule, students);
    const satisfied = seatId === rule.seatId;
    return result(
      rule,
      satisfied ? 'satisfied' : 'violated',
      {
        id: satisfied ? 'rule.satisfied.fixedSeat' : 'rule.violated.fixedSeat',
        values: { student: studentName, seat: target.seat.label ?? target.seat.id },
      },
      students,
      [rule.seatId],
    );
  }

  if (rule.kind === 'studentInRegion' || rule.kind === 'studentNotInRegion') {
    const region = context.index.room.regions.find((item) => item.id === rule.regionId);
    if (!region) return orphan(rule, 'rule.orphan.region', students);
    if (seatId === undefined) return unassigned(rule, students);
    const seat = context.index.seatById.get(seatId);
    if (!seat) return orphan(rule, 'rule.orphan.seat', students);

    const inside = seat.regionIds.has(rule.regionId);
    const satisfied = rule.kind === 'studentInRegion' ? inside : !inside;
    return result(
      rule,
      satisfied ? 'satisfied' : 'violated',
      {
        id: satisfied
          ? `rule.satisfied.${rule.kind}`
          : `rule.violated.${rule.kind}`,
        values: { student: studentName, region: region.name },
      },
      students,
      [seatId],
    );
  }

  // Object proximity.
  const object = context.index.objectById.get(rule.objectId);
  if (!object) return orphan(rule, 'rule.orphan.object', students);
  if (seatId === undefined) return unassigned(rule, students);
  const seat = context.index.seatById.get(seatId);
  if (!seat) return orphan(rule, 'rule.orphan.seat', students);

  const measured = seat.objectDistances.get(rule.objectId) ?? Number.POSITIVE_INFINITY;
  const threshold =
    rule.kind === 'studentNearObject' ? rule.maxDistance : rule.minDistance;
  const satisfied =
    rule.kind === 'studentNearObject' ? measured <= threshold : measured >= threshold;

  return result(
    rule,
    satisfied ? 'satisfied' : 'violated',
    {
      id: satisfied ? `rule.satisfied.${rule.kind}` : `rule.violated.${rule.kind}`,
      values: {
        student: studentName,
        object: object.name,
        distance: Math.round(measured),
        threshold: Math.round(threshold),
      },
    },
    students,
    [seatId],
  );
}

// ---------------------------------------------------------------------------
// Relationship rules
// ---------------------------------------------------------------------------

function evaluatePairRule(
  rule: PairRule,
  placement: Placement,
  context: EvaluationContext,
): RuleEvaluation {
  const missing = rule.studentIds.filter((id) => !context.studentNameById.has(id));
  if (missing.length > 0) return orphan(rule, 'rule.orphan.student', rule.studentIds);

  const seats = seatsForPairRule(rule, placement);
  if (!seats) return unassigned(rule, rule.studentIds);

  const seatOf = new Map(seats.map((entry) => [entry.studentId, entry.seatId]));
  const offenders: string[] = [];
  let worstValue = 0;

  for (const [a, b] of studentPairs(rule.studentIds)) {
    const seatA = seatOf.get(a);
    const seatB = seatOf.get(b);
    if (!seatA || !seatB) continue;
    const indexedA = context.index.seatById.get(seatA);
    const indexedB = context.index.seatById.get(seatB);
    if (!indexedA || !indexedB) return orphan(rule, 'rule.orphan.seat', rule.studentIds);

    let pairHolds: boolean;
    switch (rule.kind) {
      case 'pairSameCenter':
        pairHolds = indexedA.center.id === indexedB.center.id;
        break;
      case 'pairDifferentCenter':
        pairHolds = indexedA.center.id !== indexedB.center.id;
        break;
      case 'pairNotAdjacentCenters': {
        const sameCenter = indexedA.center.id === indexedB.center.id;
        const adjacent =
          context.index.adjacentCenterIds.get(indexedA.center.id)?.has(indexedB.center.id) ??
          false;
        pairHolds = !sameCenter && !adjacent;
        break;
      }
      case 'pairNear': {
        const measured = context.index.seatDistance(seatA, seatB);
        worstValue = Math.max(worstValue, measured);
        pairHolds = measured <= rule.maxDistance;
        break;
      }
      case 'pairFar':
      case 'pairMinimumDistance': {
        const measured = context.index.seatDistance(seatA, seatB);
        worstValue = worstValue === 0 ? measured : Math.min(worstValue, measured);
        pairHolds = measured >= rule.minDistance;
        break;
      }
    }

    if (!pairHolds) {
      if (!offenders.includes(a)) offenders.push(a);
      if (!offenders.includes(b)) offenders.push(b);
    }
  }

  const satisfied = offenders.length === 0;
  const values: Record<string, string | number> = {
    students: namesOf(context, satisfied ? rule.studentIds : offenders),
  };
  if (rule.kind === 'pairNear') {
    values['distance'] = Math.round(worstValue);
    values['threshold'] = Math.round(rule.maxDistance);
  } else if (rule.kind === 'pairFar' || rule.kind === 'pairMinimumDistance') {
    values['distance'] = Math.round(worstValue);
    values['threshold'] = Math.round(rule.minDistance);
  }

  return result(
    rule,
    satisfied ? 'satisfied' : 'violated',
    {
      id: satisfied ? `rule.satisfied.${rule.kind}` : `rule.violated.${rule.kind}`,
      values,
    },
    satisfied ? [...rule.studentIds] : offenders,
    seats.map((entry) => entry.seatId),
  );
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

export function evaluateRule(
  rule: SeatingRule,
  placement: Placement,
  context: EvaluationContext,
): RuleEvaluation {
  switch (rule.kind) {
    case 'studentInRegion':
    case 'studentNotInRegion':
    case 'studentNearObject':
    case 'studentFarFromObject':
    case 'studentFixedSeat':
      if (!context.studentNameById.has(rule.studentId)) {
        return orphan(rule, 'rule.orphan.student', [rule.studentId]);
      }
      return evaluateStudentRule(rule, placement, context);
    case 'pairSameCenter':
    case 'pairDifferentCenter':
    case 'pairNotAdjacentCenters':
    case 'pairNear':
    case 'pairFar':
    case 'pairMinimumDistance':
      return evaluatePairRule(rule, placement, context);
  }
}

/** Evaluates every enabled rule. Disabled rules are skipped entirely. */
export function evaluateRules(
  rules: readonly SeatingRule[],
  placement: Placement,
  context: EvaluationContext,
): RuleEvaluation[] {
  return rules
    .filter((rule) => rule.enabled)
    .map((rule) => evaluateRule(rule, placement, context));
}
