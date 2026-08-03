/**
 * Browser recovery storage (TECHNICAL_SPEC §10).
 *
 * IndexedDB, not localStorage, because a project with an embedded logo easily
 * exceeds the 5 MB localStorage ceiling. This is recovery only: the UI must
 * never present it as durable storage, and exported JSON remains the source of
 * truth the user owns.
 */

import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';
import type { SeatingProject } from '../domain/types';

const DB_NAME = 'seating-plan-helper';
const DB_VERSION = 1;

export const DRAFT_STORE = 'drafts';
export const PREFERENCES_STORE = 'preferences';

export interface DraftRecord {
  id: string;
  title: string;
  updatedAt: string;
  studentCount: number;
  seatCount: number;
  project: SeatingProject;
}

interface SeatingDb extends DBSchema {
  drafts: {
    key: string;
    value: DraftRecord;
    indexes: { 'by-updatedAt': string };
  };
  preferences: {
    key: string;
    value: unknown;
  };
}

let dbPromise: Promise<IDBPDatabase<SeatingDb>> | null = null;

function getDb(): Promise<IDBPDatabase<SeatingDb>> {
  if (!dbPromise) {
    dbPromise = openDB<SeatingDb>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(DRAFT_STORE)) {
          const store = db.createObjectStore(DRAFT_STORE, { keyPath: 'id' });
          store.createIndex('by-updatedAt', 'updatedAt');
        }
        if (!db.objectStoreNames.contains(PREFERENCES_STORE)) {
          db.createObjectStore(PREFERENCES_STORE);
        }
      },
    });
  }
  return dbPromise;
}

export function isPersistenceAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

export type StorageOutcome =
  | { ok: true }
  | { ok: false; reason: 'quota' | 'unavailable' | 'unknown'; detail?: string };

function classifyError(error: unknown): StorageOutcome {
  if (error instanceof DOMException) {
    if (error.name === 'QuotaExceededError') return { ok: false, reason: 'quota' };
    return { ok: false, reason: 'unknown', detail: error.name };
  }
  return {
    ok: false,
    reason: 'unknown',
    detail: error instanceof Error ? error.message : String(error),
  };
}

function seatCountOf(project: SeatingProject): number {
  return project.room.centers.reduce((total, center) => total + center.seats.length, 0);
}

/**
 * Writes the recovery draft. Failures are returned, never thrown: a full disk
 * must not take the editor down with it.
 */
export async function saveDraft(project: SeatingProject): Promise<StorageOutcome> {
  if (!isPersistenceAvailable()) return { ok: false, reason: 'unavailable' };
  try {
    const db = await getDb();
    const record: DraftRecord = {
      id: project.id,
      title: project.metadata.title ?? project.metadata.className ?? '',
      updatedAt: new Date().toISOString(),
      studentCount: project.roster.length,
      seatCount: seatCountOf(project),
      project,
    };
    await db.put(DRAFT_STORE, record);
    return { ok: true };
  } catch (error) {
    return classifyError(error);
  }
}

/** Draft summaries, most recently updated first. */
export async function listDrafts(): Promise<DraftRecord[]> {
  if (!isPersistenceAvailable()) return [];
  try {
    const db = await getDb();
    const all = await db.getAllFromIndex(DRAFT_STORE, 'by-updatedAt');
    return all.reverse();
  } catch {
    return [];
  }
}

export async function loadDraft(id: string): Promise<SeatingProject | null> {
  if (!isPersistenceAvailable()) return null;
  try {
    const db = await getDb();
    const record = await db.get(DRAFT_STORE, id);
    return record?.project ?? null;
  } catch {
    return null;
  }
}

export async function deleteDraft(id: string): Promise<void> {
  if (!isPersistenceAvailable()) return;
  try {
    const db = await getDb();
    await db.delete(DRAFT_STORE, id);
  } catch {
    // Deleting a draft that is already gone is not an error worth surfacing.
  }
}

/** Wipes every trace of the user's data from this browser (§7 of the product spec). */
export async function clearAllLocalData(): Promise<void> {
  if (!isPersistenceAvailable()) return;
  const db = await getDb();
  await db.clear(DRAFT_STORE);
  await db.clear(PREFERENCES_STORE);
}

export async function getPreference<T>(key: string): Promise<T | undefined> {
  if (!isPersistenceAvailable()) return undefined;
  try {
    const db = await getDb();
    return (await db.get(PREFERENCES_STORE, key)) as T | undefined;
  } catch {
    return undefined;
  }
}

export async function setPreference(key: string, value: unknown): Promise<void> {
  if (!isPersistenceAvailable()) return;
  try {
    const db = await getDb();
    await db.put(PREFERENCES_STORE, value, key);
  } catch {
    // Preferences are non-essential; losing one must not interrupt the user.
  }
}

export interface StorageUsage {
  usageBytes: number | null;
  quotaBytes: number | null;
}

/** Approximate local storage usage, for the privacy panel. */
export async function estimateStorageUsage(): Promise<StorageUsage> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return { usageBytes: null, quotaBytes: null };
  }
  try {
    const estimate = await navigator.storage.estimate();
    return {
      usageBytes: estimate.usage ?? null,
      quotaBytes: estimate.quota ?? null,
    };
  } catch {
    return { usageBytes: null, quotaBytes: null };
  }
}

/**
 * Debounced autosave. Autosave must not create undo entries, so callers wire
 * this to store changes rather than to the command history.
 */
export function createAutosaver(delayMs: number, onOutcome?: (outcome: StorageOutcome) => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: SeatingProject | null = null;

  const flush = async (): Promise<void> => {
    const project = pending;
    pending = null;
    timer = null;
    if (!project) return;
    const outcome = await saveDraft(project);
    onOutcome?.(outcome);
  };

  return {
    schedule(project: SeatingProject): void {
      pending = project;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => void flush(), delayMs);
    },
    async flushNow(): Promise<void> {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      await flush();
    },
    cancel(): void {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}
