import { describe, expect, it } from 'vitest';
import {
  buildImportPreview,
  detectDelimiter,
  extractNames,
  normalizeForComparison,
  parsePastedNames,
  parseTable,
  rosterToCsv,
} from './csv';

describe('detectDelimiter', () => {
  it('detects commas', () => {
    expect(detectDelimiter('nome,turma\nAna,5A')).toBe(',');
  });

  it('detects semicolons, as exported by Portuguese-locale Excel', () => {
    expect(detectDelimiter('nome;turma\nAna;5A')).toBe(';');
  });

  it('detects tabs', () => {
    expect(detectDelimiter('nome\tturma\nAna\t5A')).toBe('\t');
  });

  it('falls back to comma for a single column', () => {
    expect(detectDelimiter('Ana\nBruno')).toBe(',');
  });
});

describe('parseTable', () => {
  it('strips a UTF-8 BOM', () => {
    const { rows } = parseTable('﻿nome\nAna');
    expect(rows[0]).toEqual(['nome']);
  });

  it('handles CRLF line endings', () => {
    const { rows } = parseTable('nome\r\nAna\r\nBruno');
    expect(rows).toEqual([['nome'], ['Ana'], ['Bruno']]);
  });

  it('keeps quoted fields containing the delimiter', () => {
    const { rows } = parseTable('nome,turma\n"Silva, Ana",5A');
    expect(rows[1]).toEqual(['Silva, Ana', '5A']);
  });

  it('unescapes doubled quotes', () => {
    const { rows } = parseTable('nome\n"Ana ""Aninha"" Souza"');
    expect(rows[1]).toEqual(['Ana "Aninha" Souza']);
  });

  it('skips blank lines', () => {
    const { rows } = parseTable('Ana\n\n\nBruno');
    expect(rows).toEqual([['Ana'], ['Bruno']]);
  });
});

describe('buildImportPreview', () => {
  it('recognizes a Portuguese header and suggests that column', () => {
    const preview = buildImportPreview('turma,nome\n5A,Ana\n5A,Bruno');
    expect(preview.suggestedHasHeader).toBe(true);
    expect(preview.suggestedNameColumn).toBe(1);
    expect(preview.columns).toEqual(['turma', 'nome']);
  });

  it('recognizes an English header', () => {
    const preview = buildImportPreview('name,class\nAna,5A');
    expect(preview.suggestedNameColumn).toBe(0);
  });

  it('guesses the most textual column when there is no header', () => {
    const preview = buildImportPreview('1,Ana Souza\n2,Bruno Lima');
    expect(preview.suggestedHasHeader).toBe(false);
    expect(preview.suggestedNameColumn).toBe(1);
  });

  it('numbers columns when there is no header', () => {
    const preview = buildImportPreview('1,Ana\n2,Bruno');
    expect(preview.columns).toEqual(['1', '2']);
  });
});

describe('extractNames', () => {
  it('reads the chosen column and skips the header', () => {
    const preview = buildImportPreview('nome,turma\nAna,5A\nBruno,5A');
    const result = extractNames(preview, { nameColumn: 0, hasHeader: true });
    expect(result.names).toEqual(['Ana', 'Bruno']);
  });

  it('counts blank rows instead of importing empty names', () => {
    const preview = buildImportPreview('nome,turma\nAna,5A\n,5A');
    const result = extractNames(preview, { nameColumn: 0, hasHeader: true });
    expect(result.names).toEqual(['Ana']);
    expect(result.blankRows).toBe(1);
  });

  it('reports duplicates without dropping them', () => {
    const preview = buildImportPreview('nome\nAna\nBruno\nAna');
    const result = extractNames(preview, { nameColumn: 0, hasHeader: true });
    expect(result.names).toEqual(['Ana', 'Bruno', 'Ana']);
    expect(result.duplicates).toEqual(['Ana']);
  });

  it('treats accents and case as the same person for duplicate warnings', () => {
    const preview = buildImportPreview('nome\nJoão\njoao');
    const result = extractNames(preview, { nameColumn: 0, hasHeader: true });
    expect(result.duplicates).toEqual(['joao']);
  });

  it('preserves accents and internal spacing in stored names', () => {
    const preview = buildImportPreview('nome\n  João  da  Silva  ');
    const result = extractNames(preview, { nameColumn: 0, hasHeader: true });
    expect(result.names).toEqual(['João  da  Silva']);
  });
});

describe('parsePastedNames', () => {
  it('reads one name per line', () => {
    expect(parsePastedNames('Ana\nBruno\nCamila')).toEqual(['Ana', 'Bruno', 'Camila']);
  });

  it('splits a single separated line', () => {
    expect(parsePastedNames('Ana; Bruno; Camila')).toEqual(['Ana', 'Bruno', 'Camila']);
  });

  it('keeps multi-word names on their own line intact', () => {
    expect(parsePastedNames('Ana Souza\nBruno Lima')).toEqual(['Ana Souza', 'Bruno Lima']);
  });

  it('ignores empty input', () => {
    expect(parsePastedNames('   \n  ')).toEqual([]);
  });
});

describe('normalizeForComparison', () => {
  it('folds accents, case, and repeated whitespace', () => {
    expect(normalizeForComparison('  José   MARIA ')).toBe('jose maria');
  });
});

describe('rosterToCsv', () => {
  it('exports a name column by default', () => {
    expect(rosterToCsv([{ id: 'a', name: 'Ana' }])).toBe('name\nAna\n');
  });

  it('includes ids only on request', () => {
    expect(rosterToCsv([{ id: 'a', name: 'Ana' }], { includeIds: true })).toBe('id,name\na,Ana\n');
  });

  it('quotes fields containing separators', () => {
    expect(rosterToCsv([{ id: 'a', name: 'Silva, Ana' }])).toBe('name\n"Silva, Ana"\n');
  });

  it('round-trips through the parser', () => {
    const csv = rosterToCsv([{ id: 'a', name: 'Silva, Ana' }, { id: 'b', name: 'João' }]);
    const preview = buildImportPreview(csv);
    const result = extractNames(preview, { nameColumn: 0, hasHeader: true });
    expect(result.names).toEqual(['Silva, Ana', 'João']);
  });
});
