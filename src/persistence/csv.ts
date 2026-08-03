/**
 * CSV and pasted-text roster import (PRODUCT_SPEC §5.3, TECHNICAL_SPEC §9.3).
 *
 * Parsing is done here rather than with a dependency because the requirements
 * are narrow and specific: three candidate delimiters, a UTF-8 BOM, quoted
 * fields, and names that must survive with their accents and internal spacing
 * intact.
 */

export const SUPPORTED_DELIMITERS = [',', ';', '\t'] as const;
export type Delimiter = (typeof SUPPORTED_DELIMITERS)[number];

const BOM = '﻿';

export interface ParsedTable {
  rows: string[][];
  delimiter: Delimiter;
}

/** Strips a UTF-8 BOM and normalizes line endings. */
export function normalizeText(input: string): string {
  const withoutBom = input.startsWith(BOM) ? input.slice(BOM.length) : input;
  return withoutBom.replace(/\r\n?/g, '\n');
}

/**
 * Picks the delimiter that yields the most consistent column count across the
 * first few lines. Ties fall back to the declaration order in
 * `SUPPORTED_DELIMITERS`, which puts the comma first.
 */
export function detectDelimiter(text: string): Delimiter {
  const sample = normalizeText(text)
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .slice(0, 10);

  if (sample.length === 0) return ',';

  let best: Delimiter = ',';
  let bestScore = -1;

  for (const delimiter of SUPPORTED_DELIMITERS) {
    const counts = sample.map((line) => splitLine(line, delimiter).length);
    const first = counts[0] ?? 1;
    if (first < 2) continue;
    const consistent = counts.every((count) => count === first);
    const score = (consistent ? 1000 : 0) + first;
    if (score > bestScore) {
      bestScore = score;
      best = delimiter;
    }
  }

  return best;
}

/** Splits a single line, honouring double-quoted fields with escaped quotes. */
function splitLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char ?? '';
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === delimiter) {
      fields.push(current);
      current = '';
      continue;
    }
    current += char ?? '';
  }

  fields.push(current);
  return fields;
}

export function parseTable(text: string, delimiter?: Delimiter): ParsedTable {
  const normalized = normalizeText(text);
  const resolved = delimiter ?? detectDelimiter(normalized);
  const rows = normalized
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => splitLine(line, resolved).map((field) => field.trim()));
  return { rows, delimiter: resolved };
}

// ---------------------------------------------------------------------------
// Roster extraction
// ---------------------------------------------------------------------------

export interface ImportPreview {
  delimiter: Delimiter;
  /** Every parsed row, header included. */
  rows: string[][];
  /** Header names when `hasHeader` is on, otherwise generated column labels. */
  columns: string[];
  /** Column the parser believes holds the names. */
  suggestedNameColumn: number;
  suggestedHasHeader: boolean;
}

const NAME_HEADER_PATTERN = /^(nome|name|aluno|aluna|estudante|student)s?$/i;

/**
 * Builds the import preview the UI shows before committing (PRODUCT_SPEC §5.3).
 * Nothing is added to the roster until the user confirms the column.
 */
export function buildImportPreview(text: string, delimiter?: Delimiter): ImportPreview {
  const { rows, delimiter: resolved } = parseTable(text, delimiter);
  const first = rows[0] ?? [];

  const headerIndex = first.findIndex((cell) => NAME_HEADER_PATTERN.test(cell));
  const suggestedHasHeader = headerIndex >= 0;
  const suggestedNameColumn = suggestedHasHeader ? headerIndex : pickLongestTextColumn(rows);

  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const columns = Array.from({ length: columnCount }, (_, position) =>
    suggestedHasHeader ? (first[position] ?? `${position + 1}`) : `${position + 1}`,
  );

  return {
    delimiter: resolved,
    rows,
    columns,
    suggestedNameColumn: Math.max(0, suggestedNameColumn),
    suggestedHasHeader,
  };
}

/** Without a header, the column with the most alphabetic content wins. */
function pickLongestTextColumn(rows: readonly string[][]): number {
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  let best = 0;
  let bestScore = -1;

  for (let column = 0; column < columnCount; column += 1) {
    let score = 0;
    for (const row of rows) {
      const cell = row[column] ?? '';
      if (/\p{L}/u.test(cell)) score += cell.length;
    }
    if (score > bestScore) {
      bestScore = score;
      best = column;
    }
  }
  return best;
}

export interface ExtractOptions {
  nameColumn: number;
  hasHeader: boolean;
}

export interface ExtractedRoster {
  names: string[];
  /** Rows skipped because the chosen column was empty. */
  blankRows: number;
  /** Names that appear more than once, in first-seen order. */
  duplicates: string[];
}

/** Pulls the chosen column out of a preview, reporting blanks and duplicates. */
export function extractNames(
  preview: ImportPreview,
  options: ExtractOptions,
): ExtractedRoster {
  const dataRows = options.hasHeader ? preview.rows.slice(1) : preview.rows;
  const names: string[] = [];
  const seen = new Map<string, number>();
  const duplicates: string[] = [];
  let blankRows = 0;

  for (const row of dataRows) {
    const raw = row[options.nameColumn] ?? '';
    const name = raw.trim();
    if (name.length === 0) {
      blankRows += 1;
      continue;
    }
    names.push(name);

    const key = normalizeForComparison(name);
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count === 2) duplicates.push(name);
  }

  return { names, blankRows, duplicates };
}

/**
 * Comparison key for duplicate detection: case- and accent-insensitive, but the
 * stored name always keeps its original form.
 */
export function normalizeForComparison(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Pasted text where each line is one name. Falls back to splitting on a
 * detected delimiter when the text is clearly a single line of separated names.
 */
export function parsePastedNames(text: string): string[] {
  const normalized = normalizeText(text);
  const lines = normalized.split('\n').filter((line) => line.trim().length > 0);

  if (lines.length > 1) {
    return lines.map((line) => line.trim());
  }

  const single = lines[0] ?? '';
  const delimiter = detectDelimiter(single);
  return splitLine(single, delimiter)
    .map((field) => field.trim())
    .filter((field) => field.length > 0);
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function escapeField(value: string): string {
  return /[",;\t\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export interface RosterCsvOptions {
  /** Advanced export only: includes the stable local ids (§9.3). */
  includeIds?: boolean;
}

export function rosterToCsv(
  roster: ReadonlyArray<{ id: string; name: string }>,
  options: RosterCsvOptions = {},
): string {
  const header = options.includeIds ? ['id', 'name'] : ['name'];
  const lines = [header.join(',')];
  for (const student of roster) {
    const fields = options.includeIds
      ? [escapeField(student.id), escapeField(student.name)]
      : [escapeField(student.name)];
    lines.push(fields.join(','));
  }
  return `${lines.join('\n')}\n`;
}
