/**
 * Rule creation form (PRODUCT_SPEC §5.5).
 *
 * Distance is offered as the human-facing presets "perto"/"longe" plus a custom
 * value, but whatever the user picks is resolved to a number and stored on the
 * rule, so reopening the project reproduces the same result even if the room is
 * later resized (TECHNICAL_SPEC §6.3).
 */

import { useMemo, useState } from 'react';
import { allSeats } from '../domain/room';
import type { GroupMode, RuleKind, SeatingProject, SeatingRule } from '../domain/types';
import { useMessages } from '../i18n/useMessages';
import { createId } from '../shared/id';
import { seatDisplayLabel } from '../shared/labels';
import { NumberField, SelectField, Toggle } from '../shared/ui';

const RULE_KINDS: RuleKind[] = [
  'studentInRegion',
  'studentNotInRegion',
  'studentNearObject',
  'studentFarFromObject',
  'studentFixedSeat',
  'pairSameCenter',
  'pairDifferentCenter',
  'pairNotAdjacentCenters',
  'pairNear',
  'pairFar',
  'pairMinimumDistance',
];

const PAIR_KINDS = new Set<RuleKind>([
  'pairSameCenter',
  'pairDifferentCenter',
  'pairNotAdjacentCenters',
  'pairNear',
  'pairFar',
  'pairMinimumDistance',
]);

const DISTANCE_KINDS = new Set<RuleKind>([
  'studentNearObject',
  'studentFarFromObject',
  'pairNear',
  'pairFar',
  'pairMinimumDistance',
]);

export interface RuleFormProps {
  project: SeatingProject;
  onSubmit: (rule: SeatingRule) => void;
  onCancel: () => void;
}

export function RuleForm({ project, onSubmit, onCancel }: RuleFormProps): JSX.Element {
  const { t } = useMessages();
  const [kind, setKind] = useState<RuleKind>('studentInRegion');
  const [severity, setSeverity] = useState<'required' | 'preferred'>('preferred');
  const [weight, setWeight] = useState(1);
  const [studentId, setStudentId] = useState(project.roster[0]?.id ?? '');
  const [studentIds, setStudentIds] = useState<string[]>([]);
  const [regionId, setRegionId] = useState(project.room.regions[0]?.id ?? '');
  const [objectId, setObjectId] = useState(project.room.objects[0]?.id ?? '');
  const [seatId, setSeatId] = useState(allSeats(project.room)[0]?.seat.id ?? '');
  const [distanceMode, setDistanceMode] = useState<'near' | 'far' | 'custom'>('near');
  const [customDistance, setCustomDistance] = useState(project.generation.nearDistance);
  const [groupMode, setGroupMode] = useState<GroupMode>('any');

  const seatOptions = useMemo(
    () =>
      allSeats(project.room).map(({ seat, center }) => ({
        value: seat.id,
        label: seatDisplayLabel(center, seat),
      })),
    [project.room],
  );

  const isPair = PAIR_KINDS.has(kind);
  const needsDistance = DISTANCE_KINDS.has(kind);
  // For exactly two students 'all' and 'any' are the same rule, so the choice
  // would just be confusing clutter — only show it once it actually matters.
  const needsGroupMode = isPair && studentIds.length > 2;

  const resolvedDistance =
    distanceMode === 'near'
      ? project.generation.nearDistance
      : distanceMode === 'far'
        ? project.generation.farDistance
        : customDistance;

  const canSubmit = (): boolean => {
    if (isPair) return studentIds.length >= 2;
    if (!studentId) return false;
    if (kind === 'studentInRegion' || kind === 'studentNotInRegion') return Boolean(regionId);
    if (kind === 'studentNearObject' || kind === 'studentFarFromObject') return Boolean(objectId);
    if (kind === 'studentFixedSeat') return Boolean(seatId);
    return true;
  };

  const build = (): SeatingRule | null => {
    const base = { id: createId('rule'), enabled: true, severity, weight };

    switch (kind) {
      case 'studentInRegion':
      case 'studentNotInRegion':
        return { ...base, kind, studentId, regionId };
      case 'studentNearObject':
        return { ...base, kind, studentId, objectId, maxDistance: resolvedDistance };
      case 'studentFarFromObject':
        return { ...base, kind, studentId, objectId, minDistance: resolvedDistance };
      case 'studentFixedSeat':
        return { ...base, kind, studentId, seatId };
      case 'pairSameCenter':
      case 'pairDifferentCenter':
      case 'pairNotAdjacentCenters':
        return { ...base, kind, studentIds, groupMode };
      case 'pairNear':
        return { ...base, kind, studentIds, maxDistance: resolvedDistance, groupMode };
      case 'pairFar':
      case 'pairMinimumDistance':
        return { ...base, kind, studentIds, minDistance: resolvedDistance, groupMode };
      default:
        return null;
    }
  };

  return (
    <form
      className="rule-card"
      onSubmit={(event) => {
        event.preventDefault();
        const rule = build();
        if (rule) onSubmit(rule);
      }}
    >
      <SelectField
        label={t('rules.add')}
        value={kind}
        onChange={(value) => setKind(value as RuleKind)}
        options={RULE_KINDS.map((item) => ({ value: item, label: t(`ruleKind.${item}`) }))}
      />

      {isPair ? (
        <fieldset style={{ border: 'none', padding: 0, margin: '0 0 var(--space-3)' }}>
          <legend className="muted">{t('rules.students')}</legend>
          <div className="table-scroll" style={{ maxHeight: 160 }}>
            {project.roster.map((student) => (
              <label className="checkbox" key={student.id}>
                <input
                  type="checkbox"
                  checked={studentIds.includes(student.id)}
                  onChange={(event) =>
                    setStudentIds((previous) =>
                      event.target.checked
                        ? [...previous, student.id]
                        : previous.filter((id) => id !== student.id),
                    )
                  }
                />
                <span>{student.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {needsGroupMode ? (
        <div className="field">
          <label>{t('rules.groupMode.label')}</label>
          <div className="row" style={{ marginBottom: 'var(--space-1)' }}>
            <button
              type="button"
              className={groupMode === 'any' ? 'pressed' : ''}
              onClick={() => setGroupMode('any')}
            >
              {t('rules.groupMode.any')}
            </button>
            <button
              type="button"
              className={groupMode === 'all' ? 'pressed' : ''}
              onClick={() => setGroupMode('all')}
            >
              {t('rules.groupMode.all')}
            </button>
          </div>
          <p className="muted">{t('rules.groupMode.help')}</p>
        </div>
      ) : null}

      {!isPair ? (
        <SelectField
          label={t('rules.student')}
          value={studentId}
          onChange={setStudentId}
          options={project.roster.map((student) => ({
            value: student.id,
            label: student.name,
          }))}
        />
      ) : null}

      {kind === 'studentInRegion' || kind === 'studentNotInRegion' ? (
        <SelectField
          label={t('rules.region')}
          value={regionId}
          onChange={setRegionId}
          options={project.room.regions.map((region) => ({
            value: region.id,
            label: region.name,
          }))}
        />
      ) : null}

      {kind === 'studentNearObject' || kind === 'studentFarFromObject' ? (
        <SelectField
          label={t('rules.object')}
          value={objectId}
          onChange={setObjectId}
          options={project.room.objects.map((object) => ({
            value: object.id,
            label: object.name,
          }))}
        />
      ) : null}

      {kind === 'studentFixedSeat' ? (
        <SelectField
          label={t('rules.seat')}
          value={seatId}
          onChange={setSeatId}
          options={seatOptions}
        />
      ) : null}

      {needsDistance ? (
        <>
          <div className="row" style={{ marginBottom: 'var(--space-2)' }}>
            <button
              type="button"
              className={distanceMode === 'near' ? 'pressed' : ''}
              onClick={() => setDistanceMode('near')}
            >
              {t('rules.distance.near')}
            </button>
            <button
              type="button"
              className={distanceMode === 'far' ? 'pressed' : ''}
              onClick={() => setDistanceMode('far')}
            >
              {t('rules.distance.far')}
            </button>
            <button
              type="button"
              className={distanceMode === 'custom' ? 'pressed' : ''}
              onClick={() => setDistanceMode('custom')}
            >
              {t('rules.distance.custom')}
            </button>
          </div>
          {distanceMode === 'custom' ? (
            <NumberField
              label={t('rules.distance')}
              value={customDistance}
              min={0}
              onChange={setCustomDistance}
            />
          ) : (
            <p className="muted">
              {t('rules.distancePreview', {
                near: project.generation.nearDistance,
                far: project.generation.farDistance,
              })}
            </p>
          )}
        </>
      ) : null}

      <div className="row" style={{ marginBottom: 'var(--space-2)' }}>
        <button
          type="button"
          className={severity === 'required' ? 'pressed' : ''}
          onClick={() => setSeverity('required')}
        >
          {t('rules.severity.required')}
        </button>
        <button
          type="button"
          className={severity === 'preferred' ? 'pressed' : ''}
          onClick={() => setSeverity('preferred')}
        >
          {t('rules.severity.preferred')}
        </button>
      </div>
      <p className="muted" style={{ marginBottom: 'var(--space-2)' }}>
        {t('rules.severity.help')}
      </p>

      {severity === 'preferred' ? (
        <NumberField label={t('rules.weight')} value={weight} min={0} step={0.5} onChange={setWeight} />
      ) : null}

      <div className="row">
        <button type="submit" className="primary" disabled={!canSubmit()}>
          {t('common.save')}
        </button>
        <button type="button" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}

/** Human-readable summary of an existing rule, used in the rule list. */
export function describeRule(rule: SeatingRule, project: SeatingProject): string {
  const nameOf = (id: string): string =>
    project.roster.find((student) => student.id === id)?.name ?? id;

  const subject =
    'studentIds' in rule
      ? rule.studentIds.map(nameOf).join(' · ')
      : nameOf(rule.studentId);

  const target =
    'regionId' in rule
      ? (project.room.regions.find((region) => region.id === rule.regionId)?.name ?? rule.regionId)
      : 'objectId' in rule
        ? (project.room.objects.find((object) => object.id === rule.objectId)?.name ?? rule.objectId)
        : 'seatId' in rule
          ? rule.seatId
          : '';

  return target ? `${subject} → ${target}` : subject;
}

export { PAIR_KINDS, RULE_KINDS };

/** Toggle used by the rule list; kept here so the list stays presentational. */
export function RuleEnabledToggle({
  enabled,
  onChange,
  label,
}: {
  enabled: boolean;
  onChange: (value: boolean) => void;
  label: string;
}): JSX.Element {
  return <Toggle label={label} checked={enabled} onChange={onChange} />;
}
