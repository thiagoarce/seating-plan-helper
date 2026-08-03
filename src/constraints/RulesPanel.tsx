/**
 * Rule list with live evaluation (PRODUCT_SPEC §5.4, §5.5).
 *
 * Every rule shows its current status against the seats as they stand, using a
 * symbol and text rather than colour alone, and orphaned references are called
 * out instead of being quietly ignored.
 */

import { useMemo, useState } from 'react';
import type { SeatingProject, SeatingRule } from '../domain/types';
import { useMessages } from '../i18n/useMessages';
import { Notice, Panel } from '../shared/ui';
import type { RuleEvaluation } from './evaluation';
import { RuleForm, describeRule } from './RuleForm';

const STATUS_SYMBOL: Record<RuleEvaluation['status'], string> = {
  satisfied: '✓',
  violated: '!',
  notApplicable: '–',
};

export interface RulesPanelProps {
  project: SeatingProject;
  evaluations: RuleEvaluation[];
  onAddRule: (rule: SeatingRule) => void;
  onUpdateRule: (ruleId: string, patch: Partial<SeatingRule>) => void;
  onRemoveRule: (ruleId: string) => void;
}

export function RulesPanel(props: RulesPanelProps): JSX.Element {
  const { t, m } = useMessages();
  const [formOpen, setFormOpen] = useState(false);
  const { project, evaluations } = props;

  const evaluationByRule = useMemo(
    () => new Map(evaluations.map((item) => [item.ruleId, item])),
    [evaluations],
  );

  const orphanCount = evaluations.filter((item) =>
    item.message.id.startsWith('rule.orphan.'),
  ).length;

  return (
    <Panel
      title={t('rules.title')}
      className="tertiary"
      actions={
        <button
          type="button"
          onClick={() => setFormOpen((open) => !open)}
          disabled={project.roster.length === 0}
          aria-expanded={formOpen}
        >
          {t('rules.add')}
        </button>
      }
    >
      {orphanCount > 0 ? (
        <Notice kind="warning">{t('rules.orphanCount', { count: orphanCount })}</Notice>
      ) : null}

      {formOpen ? (
        <RuleForm
          project={project}
          onCancel={() => setFormOpen(false)}
          onSubmit={(rule) => {
            props.onAddRule(rule);
            setFormOpen(false);
          }}
        />
      ) : null}

      {project.rules.length === 0 ? (
        <p className="empty-state">{t('rules.empty')}</p>
      ) : (
        project.rules.map((rule) => {
          const evaluation = evaluationByRule.get(rule.id);
          const isOrphan = evaluation?.message.id.startsWith('rule.orphan.') ?? false;

          return (
            <article key={rule.id} className={`rule-card${rule.enabled ? '' : ' disabled'}`}>
              <div className="rule-title">
                <span aria-hidden="true">
                  {evaluation ? STATUS_SYMBOL[evaluation.status] : STATUS_SYMBOL.notApplicable}
                </span>
                <span style={{ flex: 1 }}>{t(`ruleKind.${rule.kind}`)}</span>
                <span className={`tag ${rule.severity}`}>{t(`rules.severity.${rule.severity}`)}</span>
              </div>

              <p className="muted">{describeRule(rule, project)}</p>

              {evaluation ? (
                <p className="muted" style={{ marginTop: 'var(--space-1)' }}>
                  {m(evaluation.message)}
                </p>
              ) : null}

              {isOrphan ? <Notice kind="warning">{t('rules.orphanWarning')}</Notice> : null}

              <div className="row" style={{ marginTop: 'var(--space-2)' }}>
                <label className="checkbox" style={{ margin: 0 }}>
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    onChange={(event) =>
                      props.onUpdateRule(rule.id, { enabled: event.target.checked })
                    }
                  />
                  <span>{t('rules.enabled')}</span>
                </label>

                <button
                  type="button"
                  className="subtle"
                  onClick={() =>
                    props.onUpdateRule(rule.id, {
                      severity: rule.severity === 'required' ? 'preferred' : 'required',
                    })
                  }
                >
                  {rule.severity === 'required'
                    ? t('rules.severity.preferred')
                    : t('rules.severity.required')}
                </button>

                <button
                  type="button"
                  className="subtle danger"
                  style={{ marginLeft: 'auto' }}
                  onClick={() => props.onRemoveRule(rule.id)}
                  aria-label={`${t('rules.delete')}: ${t(`ruleKind.${rule.kind}`)}`}
                >
                  {t('rules.delete')}
                </button>
              </div>
            </article>
          );
        })
      )}
    </Panel>
  );
}
