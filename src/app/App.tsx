/**
 * Application shell: start screen, workspace steps, and the top-level
 * document actions (open/undo/redo/export).
 */

import { useEffect, useMemo } from 'react';
import { RulesPanel } from '../constraints/RulesPanel';
import { ExportPanel } from '../export/ExportPanel';
import { PlanView } from '../editor/PlanView';
import { RoomEditorView } from '../editor/RoomEditorView';
import { useMessages } from '../i18n/useMessages';
import { RosterPanel } from '../roster/RosterPanel';
import { SuggestionsPanel } from '../solver/SuggestionsPanel';
import { assignableSeatCount } from '../domain/room';
import {
  selectCanRedo,
  selectCanUndo,
  selectEvaluations,
  selectRoomIndex,
  useStore,
} from './store';
import type { WorkspaceStep } from './store';
import { StartScreen } from './StartScreen';

const STEPS: WorkspaceStep[] = ['room', 'roster', 'rules', 'plan', 'export'];

function StepNav({ step, onChange }: { step: WorkspaceStep; onChange: (step: WorkspaceStep) => void }): JSX.Element {
  const { t } = useMessages();
  return (
    <nav className="steps" aria-label={t('app.title')}>
      {STEPS.map((item) => (
        <button
          key={item}
          type="button"
          aria-current={step === item ? 'step' : undefined}
          onClick={() => onChange(item)}
        >
          {t(`app.step.${item}`)}
        </button>
      ))}
    </nav>
  );
}

export function App(): JSX.Element {
  const { t } = useMessages();
  const project = useStore((state) => state.project);
  const step = useStore((state) => state.step);
  const selection = useStore((state) => state.selection);
  const activeStudentId = useStore((state) => state.activeStudentId);
  const viewport = useStore((state) => state.viewport);
  const generation = useStore((state) => state.generation);
  const canUndo = useStore(selectCanUndo);
  const canRedo = useStore(selectCanRedo);

  const store = useStore.getState;

  // Global keyboard shortcuts: undo/redo, delete, escape (PRODUCT_SPEC §10).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
      if (typing) return;

      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault();
        store().undo();
      } else if (modifier && (event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey))) {
        event.preventDefault();
        store().redo();
      } else if (event.key === 'Escape') {
        store().clearSelection();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [store]);

  const index = useMemo(() => (project ? selectRoomIndex(project) : null), [project]);
  const evaluations = useMemo(
    () => (project && index ? selectEvaluations(project, index) : []),
    [project, index],
  );
  const seatCount = useMemo(() => (project ? assignableSeatCount(project.room) : 0), [project]);

  if (!project) {
    return <StartScreen onOpenProject={(next) => store().openProject(next)} />;
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <strong>{project.metadata.title || t('app.title')}</strong>
          <small className="muted">{t('app.privacyBadge')}</small>
        </div>

        <StepNav step={step} onChange={(next) => store().setStep(next)} />

        <div className="header-actions">
          <button type="button" onClick={() => store().undo()} disabled={!canUndo}>
            {t('editor.undo')}
          </button>
          <button type="button" onClick={() => store().redo()} disabled={!canRedo}>
            {t('editor.redo')}
          </button>
          <button type="button" className="subtle" onClick={() => store().closeProject()}>
            {t('common.back')}
          </button>
        </div>
      </header>

      {step === 'room' ? (
        <RoomEditorView
          project={project}
          selection={selection}
          viewport={viewport}
          onSelectionChange={(keys) => store().setSelection(keys)}
          onViewportChange={(next) => store().setViewport(next)}
          updateRoom={(mutate) => store().updateRoom(mutate)}
          undo={() => store().undo()}
          redo={() => store().redo()}
          canUndo={canUndo}
          canRedo={canRedo}
        />
      ) : null}

      {step === 'roster' ? (
        <div className="workspace" style={{ gridTemplateColumns: '1fr' }}>
          <RosterPanel
            project={project}
            activeStudentId={activeStudentId}
            onActivateStudent={(id) => store().setActiveStudent(id)}
            onAddStudent={(name) => store().addStudent(name)}
            onImport={(names, mode) => store().addStudents(names, mode)}
            onRename={(id, name) => store().renameStudent(id, name)}
            onRemove={(id) => store().removeStudent(id)}
            onUnassign={(id) => store().unassignStudent(id)}
            onToggleLock={(id) => store().toggleLock(id)}
            onSort={(collator) => store().sortRoster(collator)}
            onClearAssignments={() => store().clearAssignments()}
          />
        </div>
      ) : null}

      {step === 'rules' ? (
        <div className="workspace" style={{ gridTemplateColumns: '1fr' }}>
          <RulesPanel
            project={project}
            evaluations={evaluations}
            onAddRule={(rule) => store().addRule(rule)}
            onUpdateRule={(id, patch) => store().updateRule(id, patch)}
            onRemoveRule={(id) => store().removeRule(id)}
          />
        </div>
      ) : null}

      {step === 'plan' ? (
        <div className="workspace">
          <RosterPanel
            project={project}
            activeStudentId={activeStudentId}
            onActivateStudent={(id) => store().setActiveStudent(id)}
            onAddStudent={(name) => store().addStudent(name)}
            onImport={(names, mode) => store().addStudents(names, mode)}
            onRename={(id, name) => store().renameStudent(id, name)}
            onRemove={(id) => store().removeStudent(id)}
            onUnassign={(id) => store().unassignStudent(id)}
            onToggleLock={(id) => store().toggleLock(id)}
            onSort={(collator) => store().sortRoster(collator)}
            onClearAssignments={() => store().clearAssignments()}
          />

          {index ? (
            <PlanView
              project={project}
              index={index}
              evaluations={evaluations}
              viewport={viewport}
              onViewportChange={(next) => store().setViewport(next)}
              activeStudentId={activeStudentId}
              onAssign={(studentId, seatId) => {
                store().assignStudent(studentId, seatId);
                store().setActiveStudent(null);
              }}
            />
          ) : null}

          <SuggestionsPanel
            project={project}
            generation={generation}
            seatCount={seatCount}
            onGenerate={() => void store().generate()}
            onCancel={() => store().cancelGeneration()}
            onApply={(suggestion) => store().applySuggestion(suggestion)}
          />
        </div>
      ) : null}

      {step === 'export' ? (
        <div className="workspace" style={{ gridTemplateColumns: '1fr' }}>
          <ExportPanel
            project={project}
            onSetMetadata={(patch) => store().setMetadata(patch)}
            onSetBranding={(patch) => store().setBranding(patch)}
            onSetExportLayout={(patch) => store().setExportLayout(patch)}
            onAddAsset={(asset) =>
              store().commit((draft) => {
                draft.assetStore.assets = [
                  ...draft.assetStore.assets.filter((item) => item.id !== asset.id),
                  asset,
                ];
              })
            }
          />
        </div>
      ) : null}
    </div>
  );
}
