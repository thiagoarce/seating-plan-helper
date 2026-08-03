/**
 * Manual placement screen (PRODUCT_SPEC §5.4).
 *
 * Room geometry is frozen here; the canvas exists to receive students. Rule
 * violations are recomputed from the live placement on every render so the
 * highlighted seats are never stale.
 */

import { useMemo } from 'react';
import type { RuleEvaluation } from '../constraints/evaluation';
import type { RoomIndex } from '../domain/room';
import type { Store } from '../app/store';
import { useMessages } from '../i18n/useMessages';
import {
  DEFAULT_ROOM_VIEW_OPTIONS,
  buildSeatPresentations,
  planNameFontSize,
} from '../shared/RoomGraphics';
import { RoomCanvas } from './RoomCanvas';

export interface PlanViewProps {
  project: NonNullable<Store['project']>;
  index: RoomIndex;
  evaluations: RuleEvaluation[];
  viewport: Store['viewport'];
  onViewportChange: (viewport: Partial<Store['viewport']>) => void;
  activeStudentId: string | null;
  onAssign: (studentId: string, seatId: string) => void;
}

export function PlanView(props: PlanViewProps): JSX.Element {
  const { t } = useMessages();
  const { project, evaluations } = props;

  const studentNameById = useMemo(
    () => new Map(project.roster.map((student) => [student.id, student.name])),
    [project.roster],
  );
  const placement = useMemo(
    () => new Map(project.assignments.map((item) => [item.studentId, item.seatId])),
    [project.assignments],
  );
  const lockedStudentIds = useMemo(
    () => new Set(project.assignments.filter((item) => item.locked).map((item) => item.studentId)),
    [project.assignments],
  );
  const violatingSeatIds = useMemo(() => {
    const ids = new Set<string>();
    for (const evaluation of evaluations) {
      if (evaluation.status !== 'violated') continue;
      for (const seatId of evaluation.involvedSeatIds) ids.add(seatId);
    }
    return ids;
  }, [evaluations]);

  const seats = useMemo(
    () =>
      buildSeatPresentations(
        project.room,
        placement,
        studentNameById,
        lockedStudentIds,
        violatingSeatIds,
      ),
    [project.room, placement, studentNameById, lockedStudentIds, violatingSeatIds],
  );

  const options = useMemo(
    () => ({
      ...DEFAULT_ROOM_VIEW_OPTIONS,
      showCenterLabels: true,
      showSeatLabels: true,
      nameStyle: project.exportLayout.nameStyle,
      fontScale: project.exportLayout.fontScale,
      // Same single name size the export uses, so what the teacher arranges
      // here is what comes out on paper.
      nameFontSize: planNameFontSize(
        seats,
        project.exportLayout.nameStyle,
        project.exportLayout.fontScale,
      ),
    }),
    [seats, project.exportLayout.nameStyle, project.exportLayout.fontScale],
  );

  const violationCount = evaluations.filter((item) => item.status === 'violated').length;

  return (
    <section className="panel canvas-panel" style={{ gridColumn: '2 / 3' }}>
      <div className="canvas-toolbar">
        <span className="muted">{t('plan.dragHint')}</span>
        <div className="separator" />
        <span className={violationCount > 0 ? 'tag required' : 'tag ok'}>
          {violationCount > 0 ? t('plan.violations', { count: violationCount }) : t('plan.noViolations')}
        </span>
      </div>

      <RoomCanvas
        room={project.room}
        seats={seats}
        options={options}
        mode="plan"
        selection={[]}
        viewport={props.viewport}
        onViewportChange={props.onViewportChange}
        onSelectionChange={() => undefined}
        onSeatDropStudent={(seatId, studentId) => props.onAssign(studentId, seatId)}
        onSeatActivate={(seatId) => {
          if (props.activeStudentId) props.onAssign(props.activeStudentId, seatId);
        }}
        activeStudentId={props.activeStudentId}
      />
    </section>
  );
}
