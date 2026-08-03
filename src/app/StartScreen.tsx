/**
 * Entry screen (PRODUCT_SPEC §5.1).
 *
 * No route requires a network call or an account: every action here either
 * creates a blank document, builds one from a bundled template, reads a local
 * file, or reopens something IndexedDB already has.
 */

import { useEffect, useMemo, useState } from 'react';
import { createEmptyProject } from '../domain/defaults';
import { getCatalog, useMessages } from '../i18n/useMessages';
import { importAnyJson } from '../persistence/document';
import type { DraftRecord } from '../persistence/drafts';
import { deleteDraft, listDrafts } from '../persistence/drafts';
import { PlanDocument } from '../export/PlanDocument';
import { Notice } from '../shared/ui';
import { TEMPLATE_DESCRIPTORS, createRoomFromTemplate } from '../templates/builtin';
import type { TemplateId } from '../templates/builtin';
import type { SeatingProject } from '../domain/types';

export interface StartScreenProps {
  onOpenProject: (project: SeatingProject) => void;
}

function TemplatePreview({ id }: { id: TemplateId }): JSX.Element {
  const { locale } = useMessages();
  const catalog = getCatalog(locale);
  const room = useMemo(() => createRoomFromTemplate(id, catalog), [id, catalog]);
  const project = useMemo(() => createEmptyProject(room), [room]);
  return (
    <div className="card-preview">
      <PlanDocument project={project} catalog={catalog} bare />
    </div>
  );
}

export function StartScreen({ onOpenProject }: StartScreenProps): JSX.Element {
  const { t, locale } = useMessages();
  const catalog = getCatalog(locale);
  const [drafts, setDrafts] = useState<DraftRecord[]>([]);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    void listDrafts().then(setDrafts);
  }, []);

  const onImportFile = async (file: File): Promise<void> => {
    setImportError(null);
    const text = await file.text();
    const result = importAnyJson(text);
    if (!result.ok) {
      setImportError(t(result.error.id, result.error.values));
      return;
    }
    if (result.value.kind === 'project') {
      onOpenProject(result.value.project);
    } else {
      onOpenProject(createEmptyProject(structuredClone(result.value.template.room)));
    }
  };

  const formatWhen = (iso: string): string => {
    try {
      return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(
        new Date(iso),
      );
    } catch {
      return iso;
    }
  };

  return (
    <div className="start">
      <header>
        <h1>{t('app.title')}</h1>
        <p className="muted">{t('app.tagline')}</p>
        <span className="badge">{t('app.privacyBadge')}</span>
      </header>

      <section>
        <h2>{t('start.heading')}</h2>
        <div className="start-grid">
          <button
            type="button"
            className="card"
            onClick={() => onOpenProject(createEmptyProject())}
          >
            <strong>{t('start.newProject')}</strong>
            <span className="muted">{t('start.newProject.hint')}</span>
          </button>

          <label className="card" style={{ cursor: 'pointer' }}>
            <strong>{t('start.importProject')}</strong>
            <span className="muted">{t('start.importProject.hint')}</span>
            <input
              type="file"
              accept="application/json,.json"
              className="visually-hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void onImportFile(file);
                event.target.value = '';
              }}
            />
          </label>
        </div>
        {importError ? <Notice kind="error">{importError}</Notice> : null}
      </section>

      <section>
        <h2>{t('start.templates')}</h2>
        <div className="start-grid">
          {TEMPLATE_DESCRIPTORS.map((descriptor) => (
            <button
              key={descriptor.id}
              type="button"
              className="card"
              onClick={() => onOpenProject(createEmptyProject(createRoomFromTemplate(descriptor.id, catalog)))}
            >
              <strong>{t(descriptor.nameKey)}</strong>
              <span className="muted">{t(descriptor.descriptionKey)}</span>
              {descriptor.seatCount > 0 ? (
                <span className="muted">{t('template.seatCount', { count: descriptor.seatCount })}</span>
              ) : null}
              <TemplatePreview id={descriptor.id} />
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2>{t('start.drafts')}</h2>
        {drafts.length === 0 ? (
          <p className="empty-state">{t('start.drafts.empty')}</p>
        ) : (
          <div className="stack">
            {drafts.map((draft) => (
              <div key={draft.id} className="card" style={{ flexDirection: 'row', alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                  <strong>{draft.title || t('plan.title')}</strong>
                  <p className="muted">
                    {t('start.draft.summary', {
                      students: draft.studentCount,
                      seats: draft.seatCount,
                      when: formatWhen(draft.updatedAt),
                    })}
                  </p>
                </div>
                <button type="button" onClick={() => onOpenProject(draft.project)}>
                  {t('start.draft.open')}
                </button>
                <button
                  type="button"
                  className="subtle danger"
                  onClick={() => {
                    void deleteDraft(draft.id).then(() =>
                      setDrafts((current) => current.filter((item) => item.id !== draft.id)),
                    );
                  }}
                >
                  {t('start.draft.delete')}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2>{t('start.privacy.title')}</h2>
        <p className="muted">{t('start.privacy.body')}</p>
      </section>
    </div>
  );
}
