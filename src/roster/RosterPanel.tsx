/**
 * Roster list and manual placement controls (PRODUCT_SPEC §5.3, §5.4).
 *
 * Two placement paths are offered on purpose: native drag-and-drop for a mouse,
 * and select-then-activate for touch and keyboard. Neither is a fallback for
 * the other — the keyboard path is a first-class way to seat a class.
 */

import { useMemo, useState } from 'react';
import { useMessages } from '../i18n/useMessages';
import { normalizeForComparison, rosterToCsv } from '../persistence/csv';
import { downloadText, planFilename } from '../export/render';
import type { SeatAssignment, SeatingProject } from '../domain/types';
import { seatDisplayLabel } from '../shared/labels';
import { Notice, Panel } from '../shared/ui';
import { ImportDialog } from './ImportDialog';

export interface RosterPanelProps {
  project: SeatingProject;
  activeStudentId: string | null;
  onActivateStudent: (studentId: string | null) => void;
  onAddStudent: (name: string) => void;
  onImport: (names: string[], mode: 'replace' | 'append') => void;
  onRename: (studentId: string, name: string) => void;
  onRemove: (studentId: string) => void;
  onUnassign: (studentId: string) => void;
  onToggleLock: (studentId: string) => void;
  onSort: (collator: Intl.Collator) => void;
  onClearAssignments: () => void;
}

function seatLabelFor(project: SeatingProject, assignment: SeatAssignment | undefined): string {
  if (!assignment) return '';
  for (const center of project.room.centers) {
    const seat = center.seats.find((item) => item.id === assignment.seatId);
    if (seat) return seatDisplayLabel(center, seat);
  }
  return '';
}

export function RosterPanel(props: RosterPanelProps): JSX.Element {
  const { t, collator } = useMessages();
  const { project } = props;
  const [draft, setDraft] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');

  const assignmentByStudent = useMemo(
    () => new Map(project.assignments.map((item) => [item.studentId, item])),
    [project.assignments],
  );

  const duplicates = useMemo(() => {
    const seen = new Map<string, number>();
    const repeated: string[] = [];
    for (const student of project.roster) {
      const key = normalizeForComparison(student.name);
      const count = (seen.get(key) ?? 0) + 1;
      seen.set(key, count);
      if (count === 2) repeated.push(student.name);
    }
    return repeated;
  }, [project.roster]);

  const assignedCount = assignmentByStudent.size;

  const submitDraft = (): void => {
    const name = draft.trim();
    if (!name) return;
    props.onAddStudent(name);
    setDraft('');
  };

  return (
    <Panel
      title={t('roster.title')}
      actions={
        <>
          <button type="button" onClick={() => setImportOpen(true)}>
            {t('roster.import')}
          </button>
          <button
            type="button"
            className="subtle"
            onClick={() => props.onSort(collator)}
            disabled={project.roster.length < 2}
          >
            {t('roster.sortAlphabetical')}
          </button>
        </>
      }
      footer={
        <div className="row">
          <input
            type="text"
            value={draft}
            placeholder={t('roster.addPlaceholder')}
            aria-label={t('roster.add')}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                submitDraft();
              }
            }}
          />
          <button type="button" onClick={submitDraft} disabled={draft.trim().length === 0}>
            {t('roster.add')}
          </button>
        </div>
      }
    >
      <p className="muted" style={{ marginBottom: 'var(--space-2)' }}>
        {t('roster.count', { assigned: assignedCount, total: project.roster.length })}
      </p>

      {duplicates.length > 0 ? (
        <Notice kind="warning">
          {t('roster.duplicateWarning', {
            count: duplicates.length,
            names: duplicates.join(', '),
          })}
        </Notice>
      ) : null}

      {project.roster.length === 0 ? (
        <p className="empty-state">{t('roster.empty')}</p>
      ) : (
        <ul className="student-list">
          {project.roster.map((student) => {
            const assignment = assignmentByStudent.get(student.id);
            const isActive = props.activeStudentId === student.id;

            return (
              <li
                key={student.id}
                className={`student-item${isActive ? ' active' : ''}${assignment ? ' seated' : ''}`}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData('text/student-id', student.id);
                  event.dataTransfer.effectAllowed = 'move';
                  props.onActivateStudent(student.id);
                }}
              >
                {editingId === student.id ? (
                  <input
                    type="text"
                    value={editingValue}
                    autoFocus
                    aria-label={t('roster.rename')}
                    onChange={(event) => setEditingValue(event.target.value)}
                    onBlur={() => {
                      props.onRename(student.id, editingValue);
                      setEditingId(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        props.onRename(student.id, editingValue);
                        setEditingId(null);
                      }
                      if (event.key === 'Escape') setEditingId(null);
                    }}
                  />
                ) : (
                  <>
                    <button
                      type="button"
                      className="subtle name"
                      style={{ justifyContent: 'flex-start', flex: 1, minWidth: 0 }}
                      aria-pressed={isActive}
                      onClick={() => props.onActivateStudent(isActive ? null : student.id)}
                      onDoubleClick={() => {
                        setEditingId(student.id);
                        setEditingValue(student.name);
                      }}
                    >
                      {student.name}
                    </button>

                    {assignment ? (
                      <span className="seat-tag">{seatLabelFor(project, assignment)}</span>
                    ) : (
                      <span className="seat-tag">{t('roster.unassigned')}</span>
                    )}

                    {assignment ? (
                      <button
                        type="button"
                        className="subtle lock"
                        aria-pressed={assignment.locked}
                        title={t('roster.lockToggle')}
                        aria-label={t('roster.lockToggle')}
                        onClick={() => props.onToggleLock(student.id)}
                      >
                        {assignment.locked ? '✱' : '○'}
                      </button>
                    ) : null}

                    {assignment ? (
                      <button
                        type="button"
                        className="subtle"
                        title={t('roster.unassignStudent')}
                        aria-label={t('roster.unassignStudent')}
                        onClick={() => props.onUnassign(student.id)}
                      >
                        ↩
                      </button>
                    ) : null}

                    <button
                      type="button"
                      className="subtle danger"
                      title={t('roster.remove')}
                      aria-label={`${t('roster.remove')}: ${student.name}`}
                      onClick={() => props.onRemove(student.id)}
                    >
                      ✕
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {project.roster.length > 0 ? (
        <div className="row" style={{ marginTop: 'var(--space-3)' }}>
          <button
            type="button"
            className="subtle"
            onClick={() =>
              downloadText(
                rosterToCsv(project.roster),
                planFilename(project, 'csv'),
                'text/csv',
              )
            }
          >
            {t('roster.exportCsv')}
          </button>
          <button
            type="button"
            className="subtle"
            onClick={props.onClearAssignments}
            disabled={assignedCount === 0}
          >
            {t('roster.clearAssignments')}
          </button>
        </div>
      ) : null}

      <p className="muted" style={{ marginTop: 'var(--space-3)' }}>
        {t('plan.keyboardHint')}
      </p>

      {importOpen ? (
        <ImportDialog
          hasExistingRoster={project.roster.length > 0}
          onClose={() => setImportOpen(false)}
          onImport={(names, mode) => {
            props.onImport(names, mode);
            setImportOpen(false);
          }}
        />
      ) : null}
    </Panel>
  );
}
