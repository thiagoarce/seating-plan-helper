/**
 * Roster import (PRODUCT_SPEC §5.3).
 *
 * Pasting and CSV share one preview: the user always sees the parsed rows and
 * picks the name column before anything is added, which is what keeps a
 * semicolon-separated export from silently becoming one long "name".
 */

import { useMemo, useRef, useState } from 'react';
import { useMessages } from '../i18n/useMessages';
import {
  SUPPORTED_DELIMITERS,
  buildImportPreview,
  extractNames,
  parsePastedNames,
} from '../persistence/csv';
import type { Delimiter } from '../persistence/csv';
import { Dialog, Notice, SelectField, Toggle } from '../shared/ui';

const MAX_PREVIEW_ROWS = 8;

export interface ImportDialogProps {
  onClose: () => void;
  onImport: (names: string[], mode: 'replace' | 'append') => void;
  hasExistingRoster: boolean;
}

export function ImportDialog({
  onClose,
  onImport,
  hasExistingRoster,
}: ImportDialogProps): JSX.Element {
  const { t } = useMessages();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [text, setText] = useState('');
  const [delimiter, setDelimiter] = useState<Delimiter | 'auto'>('auto');
  const [hasHeader, setHasHeader] = useState<boolean | null>(null);
  const [nameColumn, setNameColumn] = useState<number | null>(null);
  const [mode, setMode] = useState<'replace' | 'append'>(hasExistingRoster ? 'append' : 'replace');
  const [fileError, setFileError] = useState<string | null>(null);

  const preview = useMemo(
    () => (text.trim() ? buildImportPreview(text, delimiter === 'auto' ? undefined : delimiter) : null),
    [text, delimiter],
  );

  const effectiveHasHeader = hasHeader ?? preview?.suggestedHasHeader ?? false;
  const effectiveNameColumn = nameColumn ?? preview?.suggestedNameColumn ?? 0;

  const extracted = useMemo(() => {
    if (!preview) return null;
    // A single column of plain lines is the common "pasted from a document"
    // case; treat it as a name list rather than a one-column table.
    if (preview.columns.length <= 1) {
      const names = parsePastedNames(text);
      const seen = new Map<string, number>();
      const duplicates: string[] = [];
      for (const name of names) {
        const key = name.toLocaleLowerCase();
        const count = (seen.get(key) ?? 0) + 1;
        seen.set(key, count);
        if (count === 2) duplicates.push(name);
      }
      return { names, blankRows: 0, duplicates };
    }
    return extractNames(preview, {
      nameColumn: effectiveNameColumn,
      hasHeader: effectiveHasHeader,
    });
  }, [preview, text, effectiveNameColumn, effectiveHasHeader]);

  const onFile = async (file: File): Promise<void> => {
    setFileError(null);
    try {
      const content = await file.text();
      setText(content);
      setDelimiter('auto');
      setHasHeader(null);
      setNameColumn(null);
    } catch {
      setFileError(t('file.error.notJson'));
    }
  };

  const rows = preview?.rows.slice(0, MAX_PREVIEW_ROWS) ?? [];

  return (
    <Dialog
      title={t('import.title')}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            {t('import.cancel')}
          </button>
          <button
            type="button"
            className="primary"
            disabled={!extracted || extracted.names.length === 0}
            onClick={() => {
              if (extracted) onImport(extracted.names, mode);
            }}
          >
            {t('import.confirm')}
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="import-text">{t('import.paste')}</label>
        <textarea
          id="import-text"
          value={text}
          placeholder={'Ana Souza\nBruno Lima\nCamila Dias'}
          onChange={(event) => {
            setText(event.target.value);
            setHasHeader(null);
            setNameColumn(null);
          }}
        />
        <p className="muted">{t('import.pasteHint')}</p>
      </div>

      <div className="row" style={{ marginBottom: 'var(--space-3)' }}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv,text/plain"
          className="visually-hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void onFile(file);
            event.target.value = '';
          }}
        />
        <button type="button" onClick={() => fileInputRef.current?.click()}>
          {t('import.file')}
        </button>
      </div>

      {fileError ? <Notice kind="error">{fileError}</Notice> : null}

      {preview && preview.columns.length > 1 ? (
        <>
          <div className="field-row">
            <SelectField
              label={t('import.delimiter')}
              value={delimiter}
              onChange={(value) => setDelimiter(value as Delimiter | 'auto')}
              options={[
                { value: 'auto', label: 'Auto' },
                ...SUPPORTED_DELIMITERS.map((item) => ({
                  value: item,
                  label:
                    item === ','
                      ? t('import.delimiter.comma')
                      : item === ';'
                        ? t('import.delimiter.semicolon')
                        : t('import.delimiter.tab'),
                })),
              ]}
            />
            <SelectField
              label={t('import.nameColumn')}
              value={String(effectiveNameColumn)}
              onChange={(value) => setNameColumn(Number(value))}
              options={preview.columns.map((column, index) => ({
                value: String(index),
                label: column,
              }))}
            />
          </div>
          <Toggle
            label={t('import.hasHeader')}
            checked={effectiveHasHeader}
            onChange={setHasHeader}
          />
        </>
      ) : null}

      {rows.length > 0 ? (
        <div className="field">
          <label>{t('import.preview')}</label>
          <div className="table-scroll">
            <table className="preview-table">
              <tbody>
                {rows.map((row, rowIndex) => (
                  <tr key={`row-${String(rowIndex)}`}>
                    {preview?.columns.map((_, columnIndex) => (
                      <td
                        key={`cell-${String(rowIndex)}-${String(columnIndex)}`}
                        className={columnIndex === effectiveNameColumn ? 'name-column' : ''}
                      >
                        {row[columnIndex] ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {extracted ? (
        <>
          <p>{t('import.summary', { count: extracted.names.length })}</p>
          {extracted.blankRows > 0 ? (
            <Notice kind="warning">{t('import.blankRows', { count: extracted.blankRows })}</Notice>
          ) : null}
          {extracted.duplicates.length > 0 ? (
            <Notice kind="warning">
              {t('import.duplicates', { names: extracted.duplicates.join(', ') })}
            </Notice>
          ) : null}
        </>
      ) : (
        <p className="muted">{t('import.empty')}</p>
      )}

      {hasExistingRoster ? (
        <div className="row" style={{ marginTop: 'var(--space-3)' }}>
          <button
            type="button"
            className={mode === 'append' ? 'pressed' : ''}
            onClick={() => setMode('append')}
          >
            {t('import.append')}
          </button>
          <button
            type="button"
            className={mode === 'replace' ? 'pressed' : ''}
            onClick={() => setMode('replace')}
          >
            {t('import.replace')}
          </button>
        </div>
      ) : null}
    </Dialog>
  );
}
