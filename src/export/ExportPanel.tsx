/**
 * Export composer (PRODUCT_SPEC §5.7, TECHNICAL_SPEC §11).
 *
 * The preview here is the exact `PlanDocument` used to produce every file
 * format, so what the teacher sees is what gets exported — no separate
 * "export renderer" that could quietly drift from the screen.
 */

import { useMemo, useRef, useState } from 'react';
import type { SeatingProject } from '../domain/types';
import { getCatalog, useMessages } from '../i18n/useMessages';
import { createId } from '../shared/id';
import { Notice, NumberField, Panel, SelectField, TextField, Toggle } from '../shared/ui';
import { analysePlan, PlanDocument } from './PlanDocument';
import {
  downloadBlob,
  downloadText,
  planFilename,
  printPlan,
  renderPlanPdf,
  renderPlanPng,
  renderPlanSvg,
} from './render';
import { projectToJson, projectToTemplate, templateToJson } from '../persistence/document';
import { rosterToCsv } from '../persistence/csv';

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const MAX_LOGO_DIMENSION = 480;

export interface ExportPanelProps {
  project: SeatingProject;
  onSetMetadata: (patch: Partial<SeatingProject['metadata']>) => void;
  onSetBranding: (patch: Partial<SeatingProject['branding']>) => void;
  onSetExportLayout: (patch: Partial<SeatingProject['exportLayout']>) => void;
  onAddAsset: (asset: SeatingProject['assetStore']['assets'][number]) => void;
}

async function readImage(file: File): Promise<{ width: number; height: number; dataUrl: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('read failed'));
    reader.readAsDataURL(file);
  });

  if (file.type === 'image/svg+xml') {
    return { width: 200, height: 80, dataUrl };
  }

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('decode failed'));
    element.src = dataUrl;
  });

  if (image.width <= MAX_LOGO_DIMENSION && image.height <= MAX_LOGO_DIMENSION) {
    return { width: image.width, height: image.height, dataUrl };
  }

  // Large uploads are resized client-side before embedding (TECHNICAL_SPEC §9.4).
  const scale = MAX_LOGO_DIMENSION / Math.max(image.width, image.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  const context = canvas.getContext('2d');
  if (!context) return { width: image.width, height: image.height, dataUrl };
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, dataUrl: canvas.toDataURL(file.type) };
}

export function ExportPanel(props: ExportPanelProps): JSX.Element {
  const { t, locale } = useMessages();
  const { project } = props;
  const catalog = getCatalog(locale);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const diagnostics = useMemo(() => analysePlan(project), [project]);
  const layout = project.exportLayout;

  const withBusy = async (label: string, task: () => Promise<void>): Promise<void> => {
    setBusy(label);
    try {
      await task();
    } finally {
      setBusy(null);
    }
  };

  const onLogoFile = async (file: File): Promise<void> => {
    setLogoError(null);
    const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
    if (!allowed.includes(file.type)) {
      setLogoError(t('branding.logoInvalidType'));
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setLogoError(t('branding.logoTooLarge', { max: Math.round(MAX_LOGO_BYTES / (1024 * 1024)) }));
      return;
    }
    const { width, height, dataUrl } = await readImage(file);
    const id = createId('asset');
    props.onAddAsset({
      id,
      name: file.name,
      mimeType: file.type,
      dataUrl,
      width,
      height,
      byteSize: file.size,
    });
    props.onSetBranding({ logoAssetId: id, showLogo: true });
  };

  return (
    <div className="export-layout">
      <div className="export-preview">
        <div className="export-page">
          <PlanDocument project={project} catalog={catalog} />
        </div>
      </div>

      <Panel title={t('export.title')} className="tertiary">
        {diagnostics.overflowingNames.length > 0 ? (
          <Notice kind="warning">{t('export.overflowWarning')}</Notice>
        ) : null}
        {diagnostics.offCanvas ? <Notice kind="warning">{t('export.offCanvasWarning')}</Notice> : null}

        <h3 style={{ marginBottom: 'var(--space-2)' }}>{t('branding.title')}</h3>
        <TextField
          label={t('branding.planTitle')}
          value={project.metadata.title ?? ''}
          onChange={(value) => props.onSetMetadata({ title: value })}
        />
        <TextField
          label={t('branding.schoolName')}
          value={project.metadata.schoolName ?? ''}
          onChange={(value) => props.onSetMetadata({ schoolName: value })}
        />
        <div className="field-row">
          <TextField
            label={t('branding.className')}
            value={project.metadata.className ?? ''}
            onChange={(value) => props.onSetMetadata({ className: value })}
          />
          <TextField
            label={t('branding.teacherName')}
            value={project.metadata.teacherName ?? ''}
            onChange={(value) => props.onSetMetadata({ teacherName: value })}
          />
        </div>
        <div className="field-row">
          <NumberField
            label={t('branding.month')}
            value={project.metadata.month ?? new Date().getMonth() + 1}
            min={1}
            max={12}
            onChange={(value) => props.onSetMetadata({ month: value })}
          />
          <NumberField
            label={t('branding.year')}
            value={project.metadata.year ?? new Date().getFullYear()}
            onChange={(value) => props.onSetMetadata({ year: value })}
          />
        </div>

        <div className="field">
          <label>{t('branding.logo')}</label>
          <div className="row">
            <input
              ref={logoInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="visually-hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void onLogoFile(file);
                event.target.value = '';
              }}
            />
            <button type="button" onClick={() => logoInputRef.current?.click()}>
              {t('branding.uploadLogo')}
            </button>
            {project.branding.logoAssetId ? (
              <button type="button" className="subtle" onClick={() => props.onSetBranding({ logoAssetId: undefined })}>
                {t('branding.removeLogo')}
              </button>
            ) : null}
          </div>
          {logoError ? <Notice kind="error">{logoError}</Notice> : null}
        </div>
        <Toggle
          label={t('branding.showLogo')}
          checked={project.branding.showLogo}
          onChange={(value) => props.onSetBranding({ showLogo: value })}
        />

        <h3 style={{ margin: 'var(--space-3) 0 var(--space-2)' }}>{t('export.title')}</h3>
        <div className="field-row">
          <SelectField
            label={t('export.pageSize')}
            value={layout.pageSize}
            onChange={(value) => props.onSetExportLayout({ pageSize: value })}
            options={[
              { value: 'A4', label: 'A4' },
              { value: 'Letter', label: 'Letter' },
            ]}
          />
          <SelectField
            label={t('export.orientation')}
            value={layout.orientation}
            onChange={(value) => props.onSetExportLayout({ orientation: value })}
            options={[
              { value: 'portrait', label: t('editor.orientation.portrait') },
              { value: 'landscape', label: t('editor.orientation.landscape') },
            ]}
          />
        </div>

        <SelectField
          label={t('export.nameStyle')}
          value={layout.nameStyle}
          onChange={(value) => props.onSetExportLayout({ nameStyle: value })}
          options={[
            { value: 'full', label: t('export.nameStyle.full') },
            { value: 'firstName', label: t('export.nameStyle.firstName') },
            { value: 'firstNameLastInitial', label: t('export.nameStyle.firstNameLastInitial') },
          ]}
        />

        <NumberField
          label={t('export.fontScale')}
          value={layout.fontScale}
          min={0.5}
          max={2}
          step={0.05}
          onChange={(value) => props.onSetExportLayout({ fontScale: value })}
        />
        <NumberField
          label={t('export.margin')}
          value={layout.margin}
          min={0}
          onChange={(value) => props.onSetExportLayout({ margin: value })}
        />

        <Toggle
          label={t('export.showRoomObjects')}
          checked={layout.showRoomObjects}
          onChange={(value) => props.onSetExportLayout({ showRoomObjects: value })}
        />
        <Toggle
          label={t('export.showRegions')}
          checked={layout.showRegions}
          onChange={(value) => props.onSetExportLayout({ showRegions: value })}
        />
        <Toggle
          label={t('export.showEmptySeats')}
          checked={layout.showEmptySeats}
          onChange={(value) => props.onSetExportLayout({ showEmptySeats: value })}
        />
        <Toggle
          label={t('export.transparentBackground')}
          checked={layout.transparentBackground}
          onChange={(value) => props.onSetExportLayout({ transparentBackground: value })}
        />
        <Toggle
          label={t('export.showHeader')}
          checked={layout.showHeader}
          onChange={(value) => props.onSetExportLayout({ showHeader: value })}
        />
        <Toggle
          label={t('export.showFooter')}
          checked={layout.showFooter}
          onChange={(value) => props.onSetExportLayout({ showFooter: value })}
        />

        <div className="stack" style={{ marginTop: 'var(--space-4)' }}>
          <button
            type="button"
            className="primary"
            disabled={busy !== null}
            onClick={() =>
              withBusy('png', async () => {
                const blob = await renderPlanPng({ project, catalog });
                downloadBlob(blob, planFilename(project, 'png'));
              })
            }
          >
            {busy === 'png' ? '…' : t('export.png')}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => downloadText(renderPlanSvg({ project, catalog }), planFilename(project, 'svg'), 'image/svg+xml')}
          >
            {t('export.svg')}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              withBusy('pdf', async () => {
                const blob = await renderPlanPdf({ project, catalog });
                downloadBlob(blob, planFilename(project, 'pdf'));
              })
            }
          >
            {busy === 'pdf' ? '…' : t('export.pdf')}
          </button>
          <button type="button" onClick={() => printPlan({ project, catalog })}>
            {t('export.print')}
          </button>
        </div>

        <div className="stack" style={{ marginTop: 'var(--space-4)' }}>
          <button
            type="button"
            className="subtle"
            onClick={() => downloadText(projectToJson(project), planFilename(project, 'json'), 'application/json')}
          >
            {t('export.projectJson')}
          </button>
          <button
            type="button"
            className="subtle"
            onClick={() => {
              const name = project.metadata.title?.trim() || t('start.newProject');
              const template = projectToTemplate(project, name);
              downloadText(
                templateToJson(template),
                planFilename(project, 'template.json'),
                'application/json',
              );
            }}
          >
            {t('export.templateJson')}
          </button>
          <button
            type="button"
            className="subtle"
            onClick={() => downloadText(rosterToCsv(project.roster), planFilename(project, 'csv'), 'text/csv')}
          >
            {t('export.rosterCsv')}
          </button>
        </div>
      </Panel>
    </div>
  );
}
