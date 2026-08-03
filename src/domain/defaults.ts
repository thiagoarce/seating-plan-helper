/**
 * Factory defaults for new documents, plus the derivation of human-facing
 * distance presets (TECHNICAL_SPEC §6.3).
 */

import { createId } from '../shared/id';
import { rotatedBounds } from './geometry';
import { CURRENT_SCHEMA_VERSION } from './types';
import type {
  BrandingConfig,
  ExportLayout,
  GenerationSettings,
  RoomDefinition,
  SeatingProject,
} from './types';

export const DEFAULT_ROOM_WIDTH = 1200;
export const DEFAULT_ROOM_HEIGHT = 800;
export const DEFAULT_GRID_SIZE = 20;

/**
 * Standard footprint of a single-seat desk, in logical units. Real desks are
 * rectangular, not square: side-to-side (`SEAT_WIDTH`) is twice front-to-back
 * (`SEAT_DEPTH`). `SEAT_SIZE` stays as the wider dimension for call sites that
 * only need a rough footprint (hit-test radius, minimum sizes, fallbacks).
 */
export const SEAT_WIDTH = 60;
export const SEAT_DEPTH = 30;
export const SEAT_SIZE = SEAT_WIDTH;

export interface DistancePresets {
  near: number;
  far: number;
  adjacentCenter: number;
}

/**
 * Resolves the "near", "far", and "adjacent" thresholds from the room itself so
 * the same preset means something comparable in a small room and a large one.
 *
 * "Near" and "far" scale with the room diagonal. "Adjacent" scales with the
 * median center size, because two islands count as neighbours when the gap
 * between them is smaller than the islands themselves.
 */
export function resolveDistancePresets(room: RoomDefinition): DistancePresets {
  const diagonal = Math.hypot(room.width, room.height);

  const sizes = room.centers
    .map((center) => {
      const bounds = rotatedBounds(center, center.rotation);
      return Math.max(bounds.width, bounds.height);
    })
    .sort((a, b) => a - b);

  const medianCenterSize =
    sizes.length === 0
      ? SEAT_SIZE * 2
      : (sizes[Math.floor((sizes.length - 1) / 2)] ?? SEAT_SIZE * 2);

  return {
    near: Math.round(diagonal * 0.16),
    far: Math.round(diagonal * 0.45),
    adjacentCenter: Math.round(medianCenterSize * 0.75),
  };
}

export function createEmptyRoom(): RoomDefinition {
  return {
    width: DEFAULT_ROOM_WIDTH,
    height: DEFAULT_ROOM_HEIGHT,
    orientation: 'landscape',
    grid: { size: DEFAULT_GRID_SIZE, visible: true, snap: true },
    centers: [],
    objects: [],
    regions: [],
    labels: [],
  };
}

export function createDefaultGeneration(room: RoomDefinition): GenerationSettings {
  const presets = resolveDistancePresets(room);
  return {
    timeBudgetMs: 8000,
    attempts: 24,
    diversityThreshold: 0.25,
    nearDistance: presets.near,
    farDistance: presets.far,
    adjacentCenterDistance: presets.adjacentCenter,
  };
}

export function createDefaultBranding(): BrandingConfig {
  return {
    primaryColor: '#1f3a5f',
    accentColor: '#2f6f4f',
    fontFamily: 'Inter, system-ui, sans-serif',
    showLogo: true,
  };
}

export function createDefaultExportLayout(): ExportLayout {
  return {
    pageSize: 'A4',
    orientation: 'landscape',
    margin: 32,
    showRoomObjects: true,
    showSeats: true,
    showRegions: false,
    showEmptySeats: true,
    fontScale: 1,
    nameStyle: 'full',
    transparentBackground: false,
    showHeader: true,
    showFooter: true,
  };
}

export function createEmptyProject(room: RoomDefinition = createEmptyRoom()): SeatingProject {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: createId('project'),
    metadata: {},
    room,
    roster: [],
    rules: [],
    assignments: [],
    generation: createDefaultGeneration(room),
    branding: createDefaultBranding(),
    exportLayout: createDefaultExportLayout(),
    assetStore: { assets: [] },
    updatedAt: new Date().toISOString(),
  };
}
