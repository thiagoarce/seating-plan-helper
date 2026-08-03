/**
 * Suggestion review (PRODUCT_SPEC §5.6).
 *
 * Generation is never a black box here: each plan shows its score, whether the
 * required rules held, what it gave up, and a preview of the actual seating. If
 * nothing valid exists, the panel says so and names the rules that blocked the
 * search instead of quietly returning something that breaks them.
 */

import { useMemo } from 'react';
import { PlanDocument } from '../export/PlanDocument';
import type { SeatingProject } from '../domain/types';
import { getCatalog, useMessages } from '../i18n/useMessages';
import { Notice, Panel } from '../shared/ui';
import type { GenerationState } from '../app/store';
import type { SeatingSuggestion } from './types';

export interface SuggestionsPanelProps {
  project: SeatingProject;
  generation: GenerationState;
  seatCount: number;
  onGenerate: () => void;
  onCancel: () => void;
  onApply: (suggestion: SeatingSuggestion) => void;
}

function SuggestionCard({
  project,
  suggestion,
  index,
  applied,
  onApply,
}: {
  project: SeatingProject;
  suggestion: SeatingSuggestion;
  index: number;
  applied: boolean;
  onApply: () => void;
}): JSX.Element {
  const { t, m, locale } = useMessages();
  const catalog = getCatalog(locale);

  const placement = useMemo(
    () => new Map(suggestion.assignments.map((item) => [item.studentId, item.seatId])),
    [suggestion.assignments],
  );

  const { score } = suggestion;

  return (
    <article className={`suggestion-card${applied ? ' applied' : ''}`}>
      <div className="row">
        <h3 style={{ flex: 1 }}>{t('suggestions.option', { index })}</h3>
        <span className="score">{score.total}</span>
      </div>

      <div className={`score-bar${score.valid ? '' : ' invalid'}`}>
        <span style={{ width: `${score.total}%` }} />
      </div>

      <p className={score.valid ? 'muted' : ''}>
        <span aria-hidden="true">{score.valid ? '✓ ' : '! '}</span>
        {score.valid ? t('suggestions.valid') : t('suggestions.invalid')}
      </p>

      <div className="suggestion-preview" style={{ margin: 'var(--space-2) 0' }}>
        <PlanDocument project={project} catalog={catalog} placement={placement} bare />
      </div>

      <ul className="muted" style={{ paddingLeft: '1.1em', margin: '0 0 var(--space-2)' }}>
        {score.explanation.map((message, position) => (
          <li key={`${message.id}-${String(position)}`}>{m(message)}</li>
        ))}
      </ul>

      <div className="row">
        <button type="button" className="primary" onClick={onApply} disabled={applied}>
          {applied ? t('suggestions.applied') : t('suggestions.apply')}
        </button>
        <span className="muted">{t('suggestions.seed', { seed: suggestion.seed })}</span>
      </div>
    </article>
  );
}

export function SuggestionsPanel(props: SuggestionsPanelProps): JSX.Element {
  const { t, m } = useMessages();
  const { project, generation, seatCount } = props;

  const lockedCount = project.assignments.filter((item) => item.locked).length;
  const canGenerate = project.roster.length > 0 && seatCount >= project.roster.length;

  return (
    <Panel
      title={t('suggestions.title')}
      className="tertiary"
      actions={
        generation.running ? (
          <button type="button" onClick={props.onCancel}>
            {t('suggestions.cancel')}
          </button>
        ) : (
          <button
            type="button"
            className="primary"
            onClick={props.onGenerate}
            disabled={!canGenerate}
          >
            {generation.result ? t('suggestions.regenerate') : t('suggestions.generate')}
          </button>
        )
      }
    >
      {project.roster.length === 0 ? (
        <Notice kind="warning">{t('suggestions.needRoster')}</Notice>
      ) : seatCount < project.roster.length ? (
        <Notice kind="warning">
          {t('solver.blocker.notEnoughSeats', {
            students: project.roster.length,
            seats: seatCount,
          })}
        </Notice>
      ) : null}

      {lockedCount > 0 ? (
        <p className="muted">{t('suggestions.lockedNote', { count: lockedCount })}</p>
      ) : null}

      {generation.running ? (
        <p role="status">
          {t('suggestions.working', {
            done: generation.progress?.attemptsRun ?? 0,
            total: generation.progress?.attemptsTotal ?? project.generation.attempts,
          })}
        </p>
      ) : null}

      {generation.result?.blockers.length ? (
        <Notice kind="error" title={t('solver.diagnostics.title')}>
          <ul style={{ margin: 0, paddingLeft: '1.1em' }}>
            {generation.result.blockers.map((blocker, index) => (
              <li key={`${blocker.id}-${String(index)}`}>{m(blocker)}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {generation.result?.notes.length ? (
        <Notice kind="warning">
          <ul style={{ margin: 0, paddingLeft: '1.1em' }}>
            {generation.result.notes.map((note, index) => (
              <li key={`${note.id}-${String(index)}`}>{m(note)}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {generation.result && generation.result.frequentBlockingRuleIds.length > 0 ? (
        <Notice kind="warning" title={t('solver.diagnostics.frequentRules')}>
          <ul style={{ margin: 0, paddingLeft: '1.1em' }}>
            {generation.result.frequentBlockingRuleIds.map((ruleId) => {
              const rule = project.rules.find((item) => item.id === ruleId);
              return (
                <li key={ruleId}>{rule ? t(`ruleKind.${rule.kind}`) : ruleId}</li>
              );
            })}
          </ul>
          <p>{t('solver.diagnostics.suggestion')}</p>
        </Notice>
      ) : null}

      {generation.result?.suggestions.length ? (
        generation.result.suggestions.map((suggestion, index) => (
          <SuggestionCard
            key={suggestion.id}
            project={project}
            suggestion={suggestion}
            index={index + 1}
            applied={generation.appliedSuggestionId === suggestion.id}
            onApply={() => props.onApply(suggestion)}
          />
        ))
      ) : generation.running ? null : (
        <p className="empty-state">{t('suggestions.empty')}</p>
      )}

      {generation.result && !generation.running ? (
        <p className="muted">{t('suggestions.elapsed', { ms: generation.result.elapsedMs })}</p>
      ) : null}
    </Panel>
  );
}
