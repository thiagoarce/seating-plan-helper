# Technical Specification

## 1. Implementation objective

Build a static, client-only web application deployable to Cloudflare Pages. It must not require a server, database, authentication provider, or private API.

The implementation should prioritize maintainability, deterministic file formats, explainable generation, and reliable high-resolution export.

---

## 2. Recommended stack

The implementer may adjust individual libraries when justified, but the target architecture is:

- TypeScript with strict mode;
- React;
- Vite;
- a lightweight state store such as Zustand;
- Konva/react-konva or an equivalent retained-mode 2D canvas library for the room editor;
- a schema validator such as Zod;
- IndexedDB through a small wrapper such as idb for recovery drafts;
- Web Worker for seating-plan generation;
- Vitest for unit tests;
- Playwright for critical browser flows;
- ESLint and Prettier;
- static deployment to Cloudflare Pages.

Do not introduce a backend merely to simplify state persistence or generation.

---

## 3. Architectural boundaries

Use these logical modules:

```text
src/
  app/                  routing, shells, global providers
  domain/               framework-independent types and rules
  editor/               room canvas and object manipulation
  roster/               roster import and editing
  constraints/          rule creation, validation, evaluation
  solver/               generation algorithms and scoring
  export/               SVG, PNG, PDF, print composition
  persistence/          JSON, CSV, IndexedDB recovery
  templates/            built-in room templates
  branding/             branding and export labels
  shared/               reusable UI and utilities
```

The domain, constraint evaluator, solver, serialization, and scoring logic must not depend on React.

---

## 4. Canonical document model

Use stable generated ids rather than student names or array indexes. UUIDs or equivalent collision-resistant local ids are acceptable.

```ts
interface SeatingProject {
  schemaVersion: number;
  id: string;
  metadata: ProjectMetadata;
  room: RoomDefinition;
  roster: Student[];
  rules: SeatingRule[];
  assignments: SeatAssignment[];
  generation: GenerationSettings;
  branding: BrandingConfig;
  exportLayout: ExportLayout;
  assetStore: AssetStore;
  updatedAt: string;
}

interface ProjectMetadata {
  title?: string;
  className?: string;
  teacherName?: string;
  schoolName?: string;
  month?: number;
  year?: number;
  notes?: string;
}

interface RoomDefinition {
  width: number;
  height: number;
  orientation: 'landscape' | 'portrait';
  grid: GridSettings;
  centers: SeatingCenter[];
  objects: RoomObject[];
  regions: Region[];
  labels: TextLabel[];
}

interface SeatingCenter {
  id: string;
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
  seats: Seat[];
  tags?: string[];
  locked?: boolean;
}

interface Seat {
  id: string;
  centerId: string;
  x: number;
  y: number;
  rotation: 0 | 90 | 180 | 270;
  label?: string;
  enabled: boolean;
  tags?: string[];
}

interface RoomObject {
  id: string;
  type: 'board' | 'door' | 'teacherDesk' | 'waterFountain' |
        'window' | 'cabinet' | 'custom';
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
  shape: 'rectangle' | 'roundedRectangle' | 'line' | 'icon';
  iconKey?: string;
  tags?: string[];
  visibleInExport: boolean;
}

interface Region {
  id: string;
  name: string;
  geometry:
    | { type: 'rectangle'; x: number; y: number; width: number; height: number }
    | { type: 'polygon'; points: Array<{ x: number; y: number }> };
  visibleInEditor: boolean;
  visibleInExport: boolean;
}

interface Student {
  id: string;
  name: string;
  displayName?: string;
  notes?: string;
  color?: string;
}

interface SeatAssignment {
  studentId: string;
  seatId: string;
  locked: boolean;
}
```

Coordinates are expressed in logical room units. Rendering scales logical units to pixels.

---

## 5. Rule model

Prefer a discriminated union. Every rule shares:

```ts
interface RuleBase {
  id: string;
  enabled: boolean;
  severity: 'required' | 'preferred';
  weight: number; // ignored or normalized for required rules
  label?: string;
}
```

Required rule kinds for the MVP:

```ts
type SeatingRule =
  | StudentInRegionRule
  | StudentNotInRegionRule
  | StudentNearObjectRule
  | StudentFarFromObjectRule
  | StudentFixedSeatRule
  | PairSameCenterRule
  | PairDifferentCenterRule
  | PairNotAdjacentCentersRule
  | PairNearRule
  | PairFarRule
  | PairMinimumDistanceRule;
```

Rules must reference ids. The application must surface orphaned references after object, region, student, center, or seat deletion.

For group relationship rules, persist a student-id set and define whether the predicate applies to every pair or only selected pairs.

---

## 6. Spatial semantics

### 6.1 Seat position

A seat’s world position is calculated from its relative coordinates and its center transform.

### 6.2 Region membership

A seat belongs to a region when its world-position center lies inside the region geometry.

### 6.3 Distance

Use Euclidean distance in logical canvas units between seat centers unless a rule explicitly targets center-to-center distance.

Normalize human-facing distance presets relative to the room or median center size so templates of different dimensions remain usable.

Suggested initial semantics:

- same center: identical `centerId`;
- adjacent centers: center bounding boxes are within an adaptive threshold and are not the same center;
- near: seat distance at or below a configurable threshold;
- far: maximize normalized distance or require a minimum threshold;
- near object: distance from seat center to the nearest point of the object bounding box;
- far from object: same metric, inverted.

Store resolved numeric thresholds in rules or generation settings so a saved project reproduces the same result.

---

## 7. Solver requirements

### 7.1 General approach

This is a constrained assignment problem. The solver should be exact enough for ordinary classroom sizes while remaining responsive in the browser.

Recommended MVP strategy:

1. Validate the problem and remove disabled seats/rules.
2. Apply locked and fixed assignments.
3. Build candidate seats for each remaining student.
4. Order students by constraint tightness.
5. Produce feasible assignments using randomized backtracking with forward checking.
6. Improve feasible candidates using local search, simulated annealing, swaps, or another heuristic.
7. Run multiple seeded attempts in a Web Worker.
8. Deduplicate materially equivalent plans.
9. Return the best three diverse solutions.

A pure random shuffle followed by scoring is not sufficient because required constraints must be enforced.

### 7.2 Required constraints

Required constraints act as feasibility predicates. A returned valid plan must satisfy all enabled required rules.

The solver should prune candidates early for:

- fixed seat;
- required region inclusion/exclusion;
- object distance limits;
- pair same/different center;
- minimum pair distance;
- center adjacency restrictions.

### 7.3 Preferred rules and scoring

Calculate a raw weighted preference score, then normalize it to 0–100.

Recommended score output:

```ts
interface SolutionScore {
  total: number; // 0..100
  requiredSatisfied: number;
  requiredTotal: number;
  preferredSatisfied: number;
  preferredTotal: number;
  weightedPreferenceRatio: number;
  violations: RuleEvaluation[];
  explanation: string[];
}
```

A plan that violates a required constraint must be marked invalid and must not receive a misleading high score.

### 7.4 Diversity

The three suggestions should not be trivial permutations. Define distance between plans as the fraction of students assigned to different seats or centers.

Prefer solutions whose pairwise plan distance exceeds a configurable threshold. If fewer than three sufficiently distinct valid solutions exist, return fewer and explain why.

### 7.5 Reproducibility

Generation settings include an optional seed. Persist the seed with each generated suggestion so a result can be reproduced during debugging.

### 7.6 Cancellation and progress

Run generation in a Web Worker and support:

- progress updates;
- timeout or iteration budget;
- cancellation;
- a best-so-far result;
- deterministic cleanup on project changes.

The main thread must remain interactive.

### 7.7 Unsatisfiable problems

Full minimal-unsatisfiable-subset detection is not required for the MVP. Implement practical diagnostics:

- detect direct contradictions, such as two students fixed to the same seat;
- report students with zero candidate seats;
- track rules most frequently responsible for pruning failed attempts;
- suggest disabling or converting likely conflicting rules to preferences.

Never silently relax required constraints.

---

## 8. Manual editor behavior

Room items share a common transform contract. Use a selection layer and transformer handles rather than embedding controls in each shape.

Required editor operations:

- click/tap selection;
- shift multi-select on desktop;
- marquee selection where practical;
- move;
- resize room objects and regions;
- rotate by 90 degrees;
- duplicate;
- delete;
- keyboard nudging;
- property-panel numeric edits;
- snapping and alignment guides;
- undo/redo.

Seat positions inside a center must remain stable when the center is moved, resized, or rotated. Center-resize behavior must be explicitly defined: either scale seat offsets or keep seats at fixed logical offsets. Prefer proportional scaling with a command to normalize seat layout.

Maintain an undo/redo command history for user mutations. Autosave should not create undo entries.

---

## 9. Import and serialization

### 9.1 JSON

All exported JSON includes:

- `schemaVersion`;
- file kind: `project`, `room-template`, `branding`, or future kinds;
- application version where available;
- created/exported timestamp;
- validated payload.

Do not serialize transient UI state such as selection, open dialogs, viewport position, or generator progress unless specifically useful.

### 9.2 Schema migration

Implement a migration pipeline:

```ts
migrateDocument(input: unknown): CurrentDocument
```

Each supported historical version migrates one step forward. Never mutate the raw imported object before validation.

### 9.3 CSV

CSV import must:

- detect comma, semicolon, or tab delimiters;
- support UTF-8 and a BOM;
- preview rows;
- allow header/no-header mode;
- let the user select the name column;
- trim whitespace without damaging internal spaces;
- warn about blank and duplicate names.

CSV export requires at least `name` and may include stable local ids only when the user explicitly chooses an advanced export.

### 9.4 Assets

Store uploaded logos and small user images as data URLs or equivalent embedded assets in the exported JSON.

Validate MIME type and file size. Resize overly large raster images client-side before embedding. Reject SVG with active or unsafe content unless sanitized and rendered through a safe pipeline.

---

## 10. Browser persistence

Use IndexedDB for local recovery because projects and embedded logos can exceed localStorage limits. localStorage may hold tiny preferences or a pointer to the most recent draft.

Suggested stores:

- `drafts`;
- `preferences`;
- `recentFileMetadata` without file-system assumptions.

Behavior:

- debounced autosave after meaningful mutations;
- recovery prompt on startup;
- explicit “clear local data” action;
- catch quota and serialization errors;
- never present browser recovery storage as durable cloud storage.

---

## 11. Export architecture

Use a single scene/document representation for screen preview and export. Avoid screenshotting the editor UI.

Preferred pipeline:

1. Convert room, assignments, branding, and export labels into an export scene graph.
2. Render the scene graph to SVG.
3. Use SVG directly for SVG export.
4. Rasterize the SVG at a chosen scale for PNG.
5. Place the SVG or raster output into a PDF page while preserving vector text when practical.
6. Use the same scene in a print-only browser view.

Export must account for:

- page size and orientation;
- margins;
- font embedding/fallbacks;
- long-name wrapping;
- output DPI;
- logo aspect ratio;
- optional transparent background;
- overflow diagnostics.

Do not depend on a server-side screenshot service.

---

## 12. Performance targets

Target ordinary use with:

- up to 60 students;
- up to 100 seats;
- up to 100 room objects/regions/labels combined;
- up to 200 rules.

Performance goals on a contemporary mid-range laptop:

- editor interaction near 60 fps during normal drag operations;
- import preview under 500 ms for common classroom files;
- first valid suggestion typically within 2 seconds for moderate constraints;
- generation budget configurable, with a default target under 8 seconds;
- PNG/PDF export under 5 seconds for A4 output in ordinary projects.

These are product targets, not guarantees for every pathological constraint set.

---

## 13. Security and privacy

- No student or project data is sent to application servers.
- No remote AI service is used for generation.
- No third-party analytics payload may include domain data.
- Avoid loading uploaded images through remote URLs.
- Sanitize imported SVG and textual content.
- Escape all names and labels in rendered HTML/SVG.
- Apply a restrictive Content Security Policy suitable for a static application.
- Avoid dependencies that require runtime secrets.

The privacy statement in the UI should accurately describe browser-local processing.

---

## 14. Internationalization

Do not hard-code UI copy throughout components. Use a message catalog from the start even if the initial release has only Portuguese and/or English.

User-entered names and labels must preserve Unicode. Sorting should use `Intl.Collator` with the active locale.

---

## 15. Testing strategy

### Unit tests

Cover:

- geometry transforms;
- region membership;
- center adjacency;
- object distance;
- every constraint evaluator;
- scoring normalization;
- JSON migrations and validation;
- CSV parsing;
- solver feasibility on small known cases;
- solver reproducibility with a fixed seed;
- solution deduplication and diversity.

### Property/invariant tests

Useful invariants:

- one student cannot occupy two seats;
- one seat cannot contain two students;
- locked assignments never change;
- valid solutions satisfy all required constraints;
- serialize/deserialize preserves domain state;
- generated assignments reference existing students and seats.

### End-to-end tests

At minimum:

1. Start from a groups-of-four template.
2. Paste a roster.
3. Create required and preferred rules.
4. Generate suggestions.
5. Apply one, swap students manually, and lock a seat.
6. Export and reimport project JSON.
7. Produce PNG/PDF/print output.
8. Restore a local recovery draft.
9. Complete essential roster and suggestion actions on a mobile viewport.

---

## 16. Delivery phases

### Phase 1 — Foundation

- project scaffolding;
- domain schemas;
- JSON import/export;
- basic application shell;
- IndexedDB draft recovery.

### Phase 2 — Room editor

- canvas;
- centers and seats;
- built-in/custom objects;
- regions;
- templates;
- snapping, transforms, undo/redo.

### Phase 3 — Roster and manual placement

- paste/CSV import;
- roster editor;
- drag, drop, swap, lock;
- live rule evaluation.

### Phase 4 — Constraint solver

- rule editor;
- Web Worker solver;
- scoring;
- three diverse suggestions;
- diagnostics and regeneration with locks.

### Phase 5 — Export and hardening

- branding;
- export composer;
- SVG/PNG/PDF/print;
- mobile refinement;
- accessibility;
- performance, privacy, and E2E tests.

---

## 17. Definition of done

A feature is done only when:

- its domain state is serializable;
- imported state is schema-validated;
- essential behavior has automated tests;
- keyboard and touch alternatives are considered;
- no domain data leaves the device;
- errors are recoverable and user-visible;
- the generated/exported result remains readable with realistic Portuguese names.

The implementation should favor a complete vertical workflow over a highly polished but disconnected editor prototype.
