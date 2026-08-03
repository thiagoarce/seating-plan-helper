/**
 * Canonical document model (TECHNICAL_SPEC §4).
 *
 * These types are framework-independent: nothing in `domain/` may import React.
 * Coordinates are always expressed in logical room units; rendering scales them
 * to pixels.
 */

export const CURRENT_SCHEMA_VERSION = 1;

export type Rotation = 0 | 90 | 180 | 270;

/**
 * A seat's own facing rotation. Wider than the quarter-turn `Rotation` used by
 * centers/objects/labels because trapezoid desks fanned into a hexagon need
 * 60°-step angles to actually point inward (§ DeskShape, `buildTrapezoidFan`).
 * Purely a rendering angle — seat position math never rotates by this value.
 */
export type SeatRotation = 0 | 30 | 60 | 90 | 120 | 150 | 180 | 210 | 240 | 270 | 300 | 330;

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Room
// ---------------------------------------------------------------------------

export interface GridSettings {
  size: number;
  visible: boolean;
  snap: boolean;
}

/**
 * Visual footprint of a seat's desk. `'trapezoid'` renders a wedge (narrow
 * edge pointing toward `rotation`'s direction, wide edge — where the chair
 * sits — opposite it), letting several seats fan out around a shared point.
 * Purely cosmetic: geometry, region membership, and distance all still use
 * the seat's single (x, y) position regardless of shape.
 */
export type DeskShape = 'rectangle' | 'trapezoid';

export interface Seat {
  id: string;
  centerId: string;
  /** Offset from the center's top-left corner, before rotation. */
  x: number;
  y: number;
  rotation: SeatRotation;
  label?: string;
  enabled: boolean;
  tags?: string[];
  deskShape?: DeskShape;
}

export interface SeatingCenter {
  id: string;
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: Rotation;
  seats: Seat[];
  tags?: string[];
  locked?: boolean;
}

export type RoomObjectType =
  | 'board'
  | 'door'
  | 'teacherDesk'
  | 'waterFountain'
  | 'window'
  | 'cabinet'
  | 'custom';

export type RoomObjectShape = 'rectangle' | 'roundedRectangle' | 'line' | 'icon';

export interface RoomObject {
  id: string;
  type: RoomObjectType;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: Rotation;
  shape: RoomObjectShape;
  iconKey?: string;
  tags?: string[];
  visibleInExport: boolean;
}

export type RegionGeometry =
  | { type: 'rectangle'; x: number; y: number; width: number; height: number }
  | { type: 'polygon'; points: Point[] };

export interface Region {
  id: string;
  name: string;
  geometry: RegionGeometry;
  visibleInEditor: boolean;
  visibleInExport: boolean;
}

export interface TextLabel {
  id: string;
  text: string;
  x: number;
  y: number;
  rotation: Rotation;
  fontSize: number;
  visibleInExport: boolean;
}

export interface RoomDefinition {
  width: number;
  height: number;
  orientation: 'landscape' | 'portrait';
  grid: GridSettings;
  centers: SeatingCenter[];
  objects: RoomObject[];
  regions: Region[];
  labels: TextLabel[];
}

// ---------------------------------------------------------------------------
// Roster and assignments
// ---------------------------------------------------------------------------

export interface Student {
  id: string;
  name: string;
  displayName?: string;
  notes?: string;
  color?: string;
}

export interface SeatAssignment {
  studentId: string;
  seatId: string;
  locked: boolean;
}

// ---------------------------------------------------------------------------
// Rules (TECHNICAL_SPEC §5)
// ---------------------------------------------------------------------------

export type RuleSeverity = 'required' | 'preferred';

export interface RuleBase {
  id: string;
  enabled: boolean;
  severity: RuleSeverity;
  /** Relative importance among preferred rules. Ignored for required rules. */
  weight: number;
  label?: string;
}

/**
 * Human-facing distance presets. Resolved to numeric thresholds at evaluation
 * time and persisted on the rule so a saved project reproduces the same result
 * (TECHNICAL_SPEC §6.3).
 */
export type DistancePreset = 'near' | 'far' | 'custom';

export interface StudentInRegionRule extends RuleBase {
  kind: 'studentInRegion';
  studentId: string;
  regionId: string;
}

export interface StudentNotInRegionRule extends RuleBase {
  kind: 'studentNotInRegion';
  studentId: string;
  regionId: string;
}

export interface StudentNearObjectRule extends RuleBase {
  kind: 'studentNearObject';
  studentId: string;
  objectId: string;
  /** Maximum distance in logical units. Resolved from a preset when created. */
  maxDistance: number;
}

export interface StudentFarFromObjectRule extends RuleBase {
  kind: 'studentFarFromObject';
  studentId: string;
  objectId: string;
  /** Minimum distance in logical units. */
  minDistance: number;
}

export interface StudentFixedSeatRule extends RuleBase {
  kind: 'studentFixedSeat';
  studentId: string;
  seatId: string;
}

/**
 * How a group rule combines the pairwise checks across a `studentIds` set of
 * more than two students:
 *
 * - `'all'`: every pair must satisfy the predicate (e.g. every pair in
 *   different centers — the whole group ends up mutually spread apart).
 * - `'any'`: at least one pair must satisfy it (e.g. not everyone crammed into
 *   the same center — a looser "don't let them all end up together" check).
 *
 * Meaningless for exactly two students, where both reduce to the same pair.
 * Defaults to `'any'` when absent, since that reads more naturally from the
 * rule's plain-language label (PRODUCT_SPEC §5.5 group rules).
 */
export type GroupMode = 'all' | 'any';

export interface PairSameCenterRule extends RuleBase {
  kind: 'pairSameCenter';
  studentIds: string[];
  groupMode?: GroupMode;
}

export interface PairDifferentCenterRule extends RuleBase {
  kind: 'pairDifferentCenter';
  studentIds: string[];
  groupMode?: GroupMode;
}

export interface PairNotAdjacentCentersRule extends RuleBase {
  kind: 'pairNotAdjacentCenters';
  studentIds: string[];
  groupMode?: GroupMode;
}

export interface PairNearRule extends RuleBase {
  kind: 'pairNear';
  studentIds: string[];
  maxDistance: number;
  groupMode?: GroupMode;
}

export interface PairFarRule extends RuleBase {
  kind: 'pairFar';
  studentIds: string[];
  minDistance: number;
  groupMode?: GroupMode;
}

export interface PairMinimumDistanceRule extends RuleBase {
  kind: 'pairMinimumDistance';
  studentIds: string[];
  minDistance: number;
  groupMode?: GroupMode;
}

export type SeatingRule =
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

export type RuleKind = SeatingRule['kind'];

/** Rules whose subject is a set of students rather than a single student. */
export type PairRule = Extract<SeatingRule, { studentIds: string[] }>;

/** Rules whose subject is a single student. */
export type StudentRule = Extract<SeatingRule, { studentId: string }>;

// ---------------------------------------------------------------------------
// Generation, branding, export
// ---------------------------------------------------------------------------

export interface GenerationSettings {
  /** Optional seed for reproducible runs. */
  seed?: number;
  /** Wall-clock budget in milliseconds. */
  timeBudgetMs: number;
  /** Number of independent seeded attempts. */
  attempts: number;
  /**
   * Minimum fraction of students that must sit differently for two solutions
   * to count as distinct (TECHNICAL_SPEC §7.4).
   */
  diversityThreshold: number;
  /** Resolved thresholds for the human-facing distance presets. */
  nearDistance: number;
  farDistance: number;
  adjacentCenterDistance: number;
}

export interface BrandingConfig {
  logoAssetId?: string;
  primaryColor: string;
  accentColor: string;
  fontFamily: string;
  showLogo: boolean;
}

export type PageSize = 'A4' | 'Letter';

export interface ExportLayout {
  pageSize: PageSize;
  orientation: 'portrait' | 'landscape';
  margin: number;
  showRoomObjects: boolean;
  showSeats: boolean;
  showRegions: boolean;
  showEmptySeats: boolean;
  fontScale: number;
  nameStyle: 'full' | 'firstName' | 'firstNameLastInitial';
  transparentBackground: boolean;
  showHeader: boolean;
  showFooter: boolean;
  footerText?: string;
}

export interface StoredAsset {
  id: string;
  name: string;
  mimeType: string;
  /** Data URL. Assets are embedded so exported JSON stays portable. */
  dataUrl: string;
  width: number;
  height: number;
  byteSize: number;
}

export interface AssetStore {
  assets: StoredAsset[];
}

export interface ProjectMetadata {
  title?: string;
  className?: string;
  teacherName?: string;
  schoolName?: string;
  month?: number;
  year?: number;
  notes?: string;
}

export interface SeatingProject {
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

/**
 * A room template carries only reusable physical and visual structure
 * (PRODUCT_SPEC §4.2). No roster, rules, or assignments.
 */
export interface RoomTemplate {
  id: string;
  name: string;
  description?: string;
  room: RoomDefinition;
  branding?: BrandingConfig;
  exportLayout?: ExportLayout;
}
