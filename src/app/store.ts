/**
 * Application store.
 *
 * The project document is the single source of truth; every user mutation goes
 * through `commit`, which pushes the previous document onto the undo stack.
 * Autosave reads the document but never writes to that stack, so recovering a
 * draft does not consume the user's undo history (TECHNICAL_SPEC §8).
 *
 * Snapshot-based history is intentional: at the stated ceilings (60 students,
 * 100 seats, 200 rules) a document is tens of kilobytes, and snapshots avoid a
 * whole class of bugs that inverse-command histories are prone to.
 */

import { create } from 'zustand';
import type { RuleEvaluation } from '../constraints/evaluation';
import { evaluateRules } from '../constraints/evaluate';
import { createDefaultGeneration, createEmptyProject, resolveDistancePresets } from '../domain/defaults';
import { buildRoomIndex } from '../domain/room';
import type { RoomIndex } from '../domain/room';
import type {
  BrandingConfig,
  ExportLayout,
  ProjectMetadata,
  RoomDefinition,
  SeatAssignment,
  SeatingProject,
  SeatingRule,
  Student,
} from '../domain/types';
import { createAutosaver } from '../persistence/drafts';
import type { StorageOutcome } from '../persistence/drafts';
import { solverClient } from '../solver/client';
import type { GenerationProgress, GenerationResult, SeatingSuggestion } from '../solver/types';
import { createId } from '../shared/id';

const MAX_HISTORY = 60;
const AUTOSAVE_DELAY_MS = 800;

export type WorkspaceStep = 'room' | 'roster' | 'rules' | 'plan' | 'export';

export interface Viewport {
  zoom: number;
  panX: number;
  panY: number;
}

export interface GenerationState {
  running: boolean;
  progress: GenerationProgress | null;
  result: GenerationResult | null;
  appliedSuggestionId: string | null;
  cancel: (() => void) | null;
}

export interface AppState {
  project: SeatingProject | null;
  past: SeatingProject[];
  future: SeatingProject[];

  step: WorkspaceStep;
  selection: string[];
  activeStudentId: string | null;
  viewport: Viewport;
  storageOutcome: StorageOutcome | null;
  lastSavedAt: string | null;

  generation: GenerationState;
}

export interface AppActions {
  // -- Document ------------------------------------------------------------
  openProject: (project: SeatingProject) => void;
  createProject: (room?: RoomDefinition) => void;
  closeProject: () => void;
  commit: (mutate: (project: SeatingProject) => void) => void;
  /** Applies a change without touching the undo stack. */
  commitSilently: (mutate: (project: SeatingProject) => void) => void;
  undo: () => void;
  redo: () => void;

  // -- Workspace -----------------------------------------------------------
  setStep: (step: WorkspaceStep) => void;
  setSelection: (keys: string[]) => void;
  toggleSelection: (key: string, additive: boolean) => void;
  clearSelection: () => void;
  setActiveStudent: (studentId: string | null) => void;
  setViewport: (viewport: Partial<Viewport>) => void;

  // -- Roster --------------------------------------------------------------
  addStudent: (name: string) => void;
  addStudents: (names: string[], mode: 'replace' | 'append') => void;
  renameStudent: (studentId: string, name: string) => void;
  removeStudent: (studentId: string) => void;
  sortRoster: (collator: Intl.Collator) => void;

  // -- Assignments ---------------------------------------------------------
  assignStudent: (studentId: string, seatId: string) => void;
  unassignStudent: (studentId: string) => void;
  clearAssignments: () => void;
  toggleLock: (studentId: string) => void;
  applySuggestion: (suggestion: SeatingSuggestion) => void;

  // -- Rules ---------------------------------------------------------------
  addRule: (rule: SeatingRule) => void;
  updateRule: (ruleId: string, patch: Partial<SeatingRule>) => void;
  removeRule: (ruleId: string) => void;

  // -- Room ----------------------------------------------------------------
  updateRoom: (mutate: (room: RoomDefinition) => void) => void;
  setRoomSize: (width: number, height: number) => void;

  // -- Presentation --------------------------------------------------------
  setMetadata: (patch: Partial<ProjectMetadata>) => void;
  setBranding: (patch: Partial<BrandingConfig>) => void;
  setExportLayout: (patch: Partial<ExportLayout>) => void;

  // -- Generation ----------------------------------------------------------
  generate: () => Promise<void>;
  cancelGeneration: () => void;
  clearSuggestions: () => void;
}

export type Store = AppState & AppActions;

const initialGeneration: GenerationState = {
  running: false,
  progress: null,
  result: null,
  appliedSuggestionId: null,
  cancel: null,
};

const initialState: AppState = {
  project: null,
  past: [],
  future: [],
  step: 'room',
  selection: [],
  activeStudentId: null,
  viewport: { zoom: 1, panX: 0, panY: 0 },
  storageOutcome: null,
  lastSavedAt: null,
  generation: initialGeneration,
};

export const useStore = create<Store>()((set, get) => {
  const autosaver = createAutosaver(AUTOSAVE_DELAY_MS, (outcome) => {
    set({
      storageOutcome: outcome,
      lastSavedAt: outcome.ok ? new Date().toISOString() : get().lastSavedAt,
    });
  });

  /**
   * Clones, mutates, stamps `updatedAt`, and schedules an autosave. `historic`
   * decides whether the previous document joins the undo stack.
   */
  const apply = (mutate: (project: SeatingProject) => void, historic: boolean): void => {
    const state = get();
    const current = state.project;
    if (!current) return;

    const next = structuredClone(current);
    mutate(next);
    next.updatedAt = new Date().toISOString();

    set({
      project: next,
      past: historic ? [...state.past, current].slice(-MAX_HISTORY) : state.past,
      future: historic ? [] : state.future,
    });
    autosaver.schedule(next);
  };

  /** Assignments must stay consistent after a roster or room change. */
  const pruneAssignments = (project: SeatingProject): void => {
    const studentIds = new Set(project.roster.map((student) => student.id));
    const seatIds = new Set(
      project.room.centers.flatMap((center) =>
        center.seats.filter((seat) => seat.enabled).map((seat) => seat.id),
      ),
    );
    project.assignments = project.assignments.filter(
      (assignment) => studentIds.has(assignment.studentId) && seatIds.has(assignment.seatId),
    );
  };

  return {
    ...initialState,

    // -- Document ----------------------------------------------------------
    openProject: (project) => {
      set({
        ...initialState,
        project,
        step: project.roster.length > 0 ? 'plan' : 'room',
      });
      autosaver.schedule(project);
    },

    createProject: (room) => {
      const project = createEmptyProject(room);
      set({ ...initialState, project });
      autosaver.schedule(project);
    },

    closeProject: () => {
      autosaver.cancel();
      get().generation.cancel?.();
      set({ ...initialState });
    },

    commit: (mutate) => apply(mutate, true),
    commitSilently: (mutate) => apply(mutate, false),

    undo: () => {
      const { past, project, future } = get();
      const previous = past[past.length - 1];
      if (!previous || !project) return;
      set({
        project: previous,
        past: past.slice(0, -1),
        future: [project, ...future].slice(0, MAX_HISTORY),
      });
      autosaver.schedule(previous);
    },

    redo: () => {
      const { future, project, past } = get();
      const next = future[0];
      if (!next || !project) return;
      set({
        project: next,
        past: [...past, project].slice(-MAX_HISTORY),
        future: future.slice(1),
      });
      autosaver.schedule(next);
    },

    // -- Workspace ---------------------------------------------------------
    setStep: (step) => set({ step }),
    setSelection: (selection) => set({ selection }),
    toggleSelection: (key, additive) =>
      set((state) => {
        if (!additive) return { selection: [key] };
        return state.selection.includes(key)
          ? { selection: state.selection.filter((item) => item !== key) }
          : { selection: [...state.selection, key] };
      }),
    clearSelection: () => set({ selection: [] }),
    setActiveStudent: (activeStudentId) => set({ activeStudentId }),
    setViewport: (viewport) => set((state) => ({ viewport: { ...state.viewport, ...viewport } })),

    // -- Roster ------------------------------------------------------------
    addStudent: (name) =>
      apply((project) => {
        project.roster.push({ id: createId('st'), name: name.trim() });
      }, true),

    addStudents: (names, mode) =>
      apply((project) => {
        const students: Student[] = names
          .map((name) => name.trim())
          .filter((name) => name.length > 0)
          .map((name) => ({ id: createId('st'), name }));

        if (mode === 'replace') {
          project.roster = students;
          project.assignments = [];
          // Rules referencing removed students are kept but will report as
          // orphaned, so the user can decide whether to delete or retarget.
        } else {
          project.roster = [...project.roster, ...students];
        }
        pruneAssignments(project);
      }, true),

    renameStudent: (studentId, name) =>
      apply((project) => {
        const student = project.roster.find((item) => item.id === studentId);
        if (student) student.name = name.trim();
      }, true),

    removeStudent: (studentId) =>
      apply((project) => {
        project.roster = project.roster.filter((student) => student.id !== studentId);
        pruneAssignments(project);
      }, true),

    sortRoster: (collator) =>
      apply((project) => {
        project.roster = [...project.roster].sort((a, b) => collator.compare(a.name, b.name));
      }, true),

    // -- Assignments -------------------------------------------------------
    assignStudent: (studentId, seatId) =>
      apply((project) => {
        const current = project.assignments.find((item) => item.studentId === studentId);
        const occupant = project.assignments.find((item) => item.seatId === seatId);

        if (occupant && occupant.studentId === studentId) return;

        // Dropping onto an occupied seat swaps the two students; if the dragged
        // student had no seat, the occupant simply loses theirs.
        if (occupant) {
          if (current) occupant.seatId = current.seatId;
          else project.assignments = project.assignments.filter((item) => item !== occupant);
        }

        if (current) current.seatId = seatId;
        else project.assignments.push({ studentId, seatId, locked: false });
      }, true),

    unassignStudent: (studentId) =>
      apply((project) => {
        project.assignments = project.assignments.filter(
          (assignment) => assignment.studentId !== studentId,
        );
      }, true),

    clearAssignments: () =>
      apply((project) => {
        project.assignments = project.assignments.filter((assignment) => assignment.locked);
      }, true),

    toggleLock: (studentId) =>
      apply((project) => {
        const assignment = project.assignments.find((item) => item.studentId === studentId);
        if (assignment) assignment.locked = !assignment.locked;
      }, true),

    applySuggestion: (suggestion) => {
      apply((project) => {
        // Locks the user already set survive; the rest come from the plan.
        const lockedByUser = new Map(
          project.assignments
            .filter((assignment) => assignment.locked)
            .map((assignment) => [assignment.studentId, assignment]),
        );
        project.assignments = suggestion.assignments.map<SeatAssignment>((assignment) => ({
          ...assignment,
          locked: lockedByUser.has(assignment.studentId),
        }));
      }, true);
      set((state) => ({
        generation: { ...state.generation, appliedSuggestionId: suggestion.id },
      }));
    },

    // -- Rules -------------------------------------------------------------
    addRule: (rule) =>
      apply((project) => {
        project.rules.push(rule);
      }, true),

    updateRule: (ruleId, patch) =>
      apply((project) => {
        const index = project.rules.findIndex((rule) => rule.id === ruleId);
        const existing = project.rules[index];
        if (index < 0 || !existing) return;
        project.rules[index] = { ...existing, ...patch } as SeatingRule;
      }, true),

    removeRule: (ruleId) =>
      apply((project) => {
        project.rules = project.rules.filter((rule) => rule.id !== ruleId);
      }, true),

    // -- Room --------------------------------------------------------------
    updateRoom: (mutate) =>
      apply((project) => {
        mutate(project.room);
        pruneAssignments(project);
        // Distance presets are derived from the room, so they follow it unless
        // the user pinned custom values.
        const presets = resolveDistancePresets(project.room);
        const defaults = createDefaultGeneration(project.room);
        if (project.generation.nearDistance === defaults.nearDistance) {
          project.generation.nearDistance = presets.near;
        }
        if (project.generation.adjacentCenterDistance === defaults.adjacentCenterDistance) {
          project.generation.adjacentCenterDistance = presets.adjacentCenter;
        }
      }, true),

    setRoomSize: (width, height) =>
      apply((project) => {
        project.room.width = width;
        project.room.height = height;
        project.room.orientation = width >= height ? 'landscape' : 'portrait';
      }, true),

    // -- Presentation ------------------------------------------------------
    setMetadata: (patch) =>
      apply((project) => {
        project.metadata = { ...project.metadata, ...patch };
      }, true),

    setBranding: (patch) =>
      apply((project) => {
        project.branding = { ...project.branding, ...patch };
      }, true),

    setExportLayout: (patch) =>
      apply((project) => {
        project.exportLayout = { ...project.exportLayout, ...patch };
      }, true),

    // -- Generation --------------------------------------------------------
    generate: async () => {
      const { project, generation } = get();
      if (!project || generation.running) return;

      generation.cancel?.();

      const handle = solverClient.generate(project, {
        onProgress: (progress) =>
          set((state) => ({ generation: { ...state.generation, progress } })),
      });

      set({
        generation: {
          running: true,
          progress: null,
          result: null,
          appliedSuggestionId: null,
          cancel: handle.cancel,
        },
      });

      try {
        const result = await handle.promise;
        set((state) => ({
          generation: { ...state.generation, running: false, result, cancel: null },
        }));
      } catch {
        set((state) => ({
          generation: { ...state.generation, running: false, cancel: null },
        }));
      }
    },

    cancelGeneration: () => {
      const { generation } = get();
      generation.cancel?.();
      set((state) => ({ generation: { ...state.generation, running: false, cancel: null } }));
    },

    clearSuggestions: () =>
      set((state) => ({
        generation: { ...state.generation, result: null, appliedSuggestionId: null },
      })),
  };
});

// ---------------------------------------------------------------------------
// Derived selectors
// ---------------------------------------------------------------------------

export function selectRoomIndex(project: SeatingProject): RoomIndex {
  return buildRoomIndex(project.room, project.generation.adjacentCenterDistance);
}

export function selectPlacement(project: SeatingProject): Map<string, string> {
  return new Map(project.assignments.map((item) => [item.studentId, item.seatId]));
}

export function selectEvaluations(project: SeatingProject, index: RoomIndex): RuleEvaluation[] {
  return evaluateRules(project.rules, selectPlacement(project), {
    index,
    studentNameById: new Map(project.roster.map((student) => [student.id, student.name])),
  });
}

export const selectCanUndo = (state: Store): boolean => state.past.length > 0;
export const selectCanRedo = (state: Store): boolean => state.future.length > 0;
