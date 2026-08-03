/**
 * JSON import/export and schema migration (TECHNICAL_SPEC §9.1, §9.2).
 *
 * Every file the application writes is wrapped in an envelope that names its
 * kind and schema version, so a future version can tell a project from a
 * template and can migrate an old file forward. Imported data is validated
 * before it is used, and the raw input object is never mutated.
 */

import { z } from 'zod';
import type { MessageDescriptor } from '../constraints/evaluation';
import {
  CURRENT_SCHEMA_VERSION,
  roomTemplateSchema,
  seatingProjectSchema,
} from '../domain/schema';
import type { DocumentKind } from '../domain/schema';
import type { RoomTemplate, SeatingProject } from '../domain/types';

export const APP_VERSION = '0.1.0';

export interface DocumentEnvelope<T = unknown> {
  kind: DocumentKind;
  schemaVersion: number;
  appVersion: string;
  exportedAt: string;
  payload: T;
}

export type ImportResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: MessageDescriptor; issues: string[] };

const envelopeSchema = z.object({
  kind: z.enum(['project', 'room-template']),
  schemaVersion: z.number().int().positive(),
  appVersion: z.string().optional(),
  exportedAt: z.string().optional(),
  payload: z.unknown(),
});

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function envelope<T>(kind: DocumentKind, payload: T): DocumentEnvelope<T> {
  return {
    kind,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    payload,
  };
}

export function projectToJson(project: SeatingProject): string {
  return JSON.stringify(envelope('project', project), null, 2);
}

/**
 * A room template is the reusable structure only: no roster, rules, or
 * assignments travel with it (PRODUCT_SPEC §4.2).
 */
export function projectToTemplate(
  project: SeatingProject,
  name: string,
  description?: string,
): RoomTemplate {
  return {
    id: project.id,
    name,
    ...(description !== undefined ? { description } : {}),
    room: project.room,
    branding: project.branding,
    exportLayout: project.exportLayout,
  };
}

export function templateToJson(template: RoomTemplate): string {
  return JSON.stringify(envelope('room-template', template), null, 2);
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

/**
 * One entry per historical version, each moving a document a single step
 * forward. Version 1 is the first released schema, so there is nothing to
 * migrate yet; the pipeline exists so that adding version 2 is a one-line
 * change rather than a refactor.
 */
const MIGRATIONS: Record<number, (input: unknown) => unknown> = {};

export function migratePayload(
  payload: unknown,
  fromVersion: number,
): ImportResult<unknown> {
  if (fromVersion > CURRENT_SCHEMA_VERSION) {
    return {
      ok: false,
      error: {
        id: 'file.error.newerSchema',
        values: { fileVersion: fromVersion, appVersion: CURRENT_SCHEMA_VERSION },
      },
      issues: [],
    };
  }

  // Structured clone keeps the caller's object untouched while migrations run.
  let current: unknown = structuredClone(payload);
  for (let version = fromVersion; version < CURRENT_SCHEMA_VERSION; version += 1) {
    const migrate = MIGRATIONS[version];
    if (!migrate) {
      return {
        ok: false,
        error: { id: 'file.error.missingMigration', values: { version } },
        issues: [],
      };
    }
    current = migrate(current);
  }
  return { ok: true, value: current };
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

function formatIssues(error: z.ZodError): string[] {
  return error.issues.slice(0, 20).map((issue) => {
    const path = issue.path.join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

function parseEnvelope(text: string): ImportResult<z.infer<typeof envelopeSchema>> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: { id: 'file.error.notJson' }, issues: [] };
  }

  const parsed = envelopeSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: { id: 'file.error.notASeatingFile' },
      issues: formatIssues(parsed.error),
    };
  }
  return { ok: true, value: parsed.data };
}

export function importProjectJson(text: string): ImportResult<SeatingProject> {
  const parsed = parseEnvelope(text);
  if (!parsed.ok) return parsed;

  if (parsed.value.kind !== 'project') {
    return {
      ok: false,
      error: { id: 'file.error.wrongKind', values: { expected: 'project', found: parsed.value.kind } },
      issues: [],
    };
  }

  const migrated = migratePayload(parsed.value.payload, parsed.value.schemaVersion);
  if (!migrated.ok) return migrated;

  const validated = seatingProjectSchema.safeParse(migrated.value);
  if (!validated.success) {
    return {
      ok: false,
      error: { id: 'file.error.invalidProject' },
      issues: formatIssues(validated.error),
    };
  }

  return { ok: true, value: { ...validated.data, schemaVersion: CURRENT_SCHEMA_VERSION } };
}

export function importTemplateJson(text: string): ImportResult<RoomTemplate> {
  const parsed = parseEnvelope(text);
  if (!parsed.ok) return parsed;

  if (parsed.value.kind !== 'room-template') {
    return {
      ok: false,
      error: {
        id: 'file.error.wrongKind',
        values: { expected: 'room-template', found: parsed.value.kind },
      },
      issues: [],
    };
  }

  const migrated = migratePayload(parsed.value.payload, parsed.value.schemaVersion);
  if (!migrated.ok) return migrated;

  const validated = roomTemplateSchema.safeParse(migrated.value);
  if (!validated.success) {
    return {
      ok: false,
      error: { id: 'file.error.invalidTemplate' },
      issues: formatIssues(validated.error),
    };
  }

  return { ok: true, value: validated.data };
}

/** Accepts either kind, for a single "import file" entry point in the UI. */
export function importAnyJson(
  text: string,
): ImportResult<{ kind: 'project'; project: SeatingProject } | { kind: 'room-template'; template: RoomTemplate }> {
  const parsed = parseEnvelope(text);
  if (!parsed.ok) return parsed;

  if (parsed.value.kind === 'project') {
    const project = importProjectJson(text);
    return project.ok ? { ok: true, value: { kind: 'project', project: project.value } } : project;
  }

  const template = importTemplateJson(text);
  return template.ok
    ? { ok: true, value: { kind: 'room-template', template: template.value } }
    : template;
}

// ---------------------------------------------------------------------------
// Referential integrity
// ---------------------------------------------------------------------------

export interface IntegrityReport {
  /** Assignments pointing at a student or seat that no longer exists. */
  danglingAssignments: number;
  /** Rules referencing a deleted student, region, object, or seat. */
  orphanRuleIds: string[];
  /** Seats claimed by more than one student. */
  duplicateSeatIds: string[];
}

/**
 * A validated file can still be internally inconsistent — for instance if it
 * was hand-edited. The UI surfaces this rather than failing the import.
 */
export function checkIntegrity(project: SeatingProject): IntegrityReport {
  const studentIds = new Set(project.roster.map((student) => student.id));
  const seatIds = new Set(
    project.room.centers.flatMap((center) => center.seats.map((seat) => seat.id)),
  );
  const regionIds = new Set(project.room.regions.map((region) => region.id));
  const objectIds = new Set(project.room.objects.map((object) => object.id));

  let danglingAssignments = 0;
  const seenSeats = new Set<string>();
  const duplicateSeatIds: string[] = [];

  for (const assignment of project.assignments) {
    if (!studentIds.has(assignment.studentId) || !seatIds.has(assignment.seatId)) {
      danglingAssignments += 1;
      continue;
    }
    if (seenSeats.has(assignment.seatId)) duplicateSeatIds.push(assignment.seatId);
    else seenSeats.add(assignment.seatId);
  }

  const orphanRuleIds: string[] = [];
  for (const rule of project.rules) {
    const students = 'studentIds' in rule ? rule.studentIds : [rule.studentId];
    let orphan = students.some((id) => !studentIds.has(id));

    if (!orphan && 'regionId' in rule) orphan = !regionIds.has(rule.regionId);
    if (!orphan && 'objectId' in rule) orphan = !objectIds.has(rule.objectId);
    if (!orphan && 'seatId' in rule) orphan = !seatIds.has(rule.seatId);

    if (orphan) orphanRuleIds.push(rule.id);
  }

  return { danglingAssignments, orphanRuleIds, duplicateSeatIds };
}
