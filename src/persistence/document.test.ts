import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION } from '../domain/types';
import { createTestProject, makeRule } from '../testing/fixtures';
import {
  checkIntegrity,
  importAnyJson,
  importProjectJson,
  importTemplateJson,
  migratePayload,
  projectToJson,
  projectToTemplate,
  templateToJson,
} from './document';

describe('project JSON round-trip', () => {
  it('preserves the full domain state', () => {
    const project = createTestProject({
      studentCount: 6,
      rules: [
        makeRule({
          id: 'r1',
          kind: 'studentInRegion',
          severity: 'required',
          studentId: 'st1',
          regionId: 'frente',
        }),
      ],
      assignments: [{ studentId: 'st1', seatId: 'a1', locked: true }],
    });

    const result = importProjectJson(projectToJson(project));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(project);
  });

  it('preserves accented names exactly', () => {
    const project = createTestProject({ studentCount: 10 });
    const result = importProjectJson(projectToJson(project));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.roster.map((student) => student.name)).toEqual(
      project.roster.map((student) => student.name),
    );
  });

  it('writes an envelope carrying kind, schema version, and app version', () => {
    const parsed = JSON.parse(projectToJson(createTestProject())) as Record<string, unknown>;
    expect(parsed['kind']).toBe('project');
    expect(parsed['schemaVersion']).toBe(CURRENT_SCHEMA_VERSION);
    expect(typeof parsed['appVersion']).toBe('string');
    expect(typeof parsed['exportedAt']).toBe('string');
  });

  it('does not serialize transient state', () => {
    const parsed = JSON.parse(projectToJson(createTestProject())) as {
      payload: Record<string, unknown>;
    };
    expect(parsed.payload['selection']).toBeUndefined();
    expect(parsed.payload['viewport']).toBeUndefined();
  });
});

describe('template JSON', () => {
  it('carries the room but not the roster, rules, or assignments', () => {
    const project = createTestProject({
      studentCount: 6,
      assignments: [{ studentId: 'st1', seatId: 'a1', locked: false }],
    });
    const template = projectToTemplate(project, 'Ilhas de quatro');
    const json = templateToJson(template);

    expect(json).not.toContain('"roster"');
    expect(json).not.toContain('"assignments"');

    const result = importTemplateJson(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.room).toEqual(project.room);
    expect(result.value.name).toBe('Ilhas de quatro');
  });
});

describe('import errors', () => {
  it('rejects text that is not JSON', () => {
    const result = importProjectJson('not json at all');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.id).toBe('file.error.notJson');
  });

  it('rejects JSON that is not a seating file', () => {
    const result = importProjectJson('{"hello":"world"}');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.id).toBe('file.error.notASeatingFile');
  });

  it('rejects a template when a project was expected', () => {
    const template = projectToTemplate(createTestProject(), 'Sala');
    const result = importProjectJson(templateToJson(template));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.id).toBe('file.error.wrongKind');
  });

  it('rejects a newer schema version with a clear message', () => {
    const envelope = JSON.stringify({
      kind: 'project',
      schemaVersion: CURRENT_SCHEMA_VERSION + 5,
      exportedAt: new Date().toISOString(),
      payload: {},
    });
    const result = importProjectJson(envelope);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.id).toBe('file.error.newerSchema');
    expect(result.error.values?.['fileVersion']).toBe(CURRENT_SCHEMA_VERSION + 5);
  });

  it('reports validation issues for a malformed payload', () => {
    const envelope = JSON.stringify({
      kind: 'project',
      schemaVersion: CURRENT_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      payload: { id: 'x', roster: 'not-an-array' },
    });
    const result = importProjectJson(envelope);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.id).toBe('file.error.invalidProject');
    expect(result.issues.length).toBeGreaterThan(0);
  });
});

describe('migratePayload', () => {
  it('passes a current-version payload through untouched', () => {
    const payload = { a: 1, nested: { b: 2 } };
    const result = migratePayload(payload, CURRENT_SCHEMA_VERSION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(payload);
  });

  it('never mutates the input object', () => {
    const payload = { nested: { b: 2 } };
    const result = migratePayload(payload, CURRENT_SCHEMA_VERSION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).not.toBe(payload);
  });

  it('refuses a version from the future', () => {
    const result = migratePayload({}, CURRENT_SCHEMA_VERSION + 1);
    expect(result.ok).toBe(false);
  });
});

describe('importAnyJson', () => {
  it('recognizes a project', () => {
    const result = importAnyJson(projectToJson(createTestProject()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe('project');
  });

  it('recognizes a template', () => {
    const template = projectToTemplate(createTestProject(), 'Sala');
    const result = importAnyJson(templateToJson(template));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe('room-template');
  });
});

describe('checkIntegrity', () => {
  it('accepts a consistent project', () => {
    const project = createTestProject({
      studentCount: 4,
      assignments: [{ studentId: 'st1', seatId: 'a1', locked: false }],
    });
    expect(checkIntegrity(project)).toEqual({
      danglingAssignments: 0,
      orphanRuleIds: [],
      duplicateSeatIds: [],
    });
  });

  it('counts assignments pointing at a missing seat', () => {
    const project = createTestProject({
      studentCount: 4,
      assignments: [{ studentId: 'st1', seatId: 'nonexistent', locked: false }],
    });
    expect(checkIntegrity(project).danglingAssignments).toBe(1);
  });

  it('flags two students sharing one seat', () => {
    const project = createTestProject({
      studentCount: 4,
      assignments: [
        { studentId: 'st1', seatId: 'a1', locked: false },
        { studentId: 'st2', seatId: 'a1', locked: false },
      ],
    });
    expect(checkIntegrity(project).duplicateSeatIds).toEqual(['a1']);
  });

  it('flags rules referencing deleted entities', () => {
    const project = createTestProject({
      studentCount: 4,
      rules: [
        makeRule({
          id: 'orphan-region',
          kind: 'studentInRegion',
          severity: 'required',
          studentId: 'st1',
          regionId: 'deleted',
        }),
        makeRule({
          id: 'orphan-student',
          kind: 'pairSameCenter',
          severity: 'preferred',
          studentIds: ['st1', 'ghost'],
        }),
        makeRule({
          id: 'fine',
          kind: 'studentNearObject',
          severity: 'preferred',
          studentId: 'st1',
          objectId: 'board',
          maxDistance: 100,
        }),
      ],
    });

    const report = checkIntegrity(project);
    expect(report.orphanRuleIds).toEqual(['orphan-region', 'orphan-student']);
  });
});
