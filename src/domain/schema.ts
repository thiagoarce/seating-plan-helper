/**
 * Runtime validation for every document that enters the application
 * (TECHNICAL_SPEC §9). Imported data is always parsed before it reaches the
 * store; the raw object is never mutated in place.
 */

import { z } from 'zod';
import type { AssertExtends } from '../shared/typeAssert';
import { CURRENT_SCHEMA_VERSION } from './types';
import type {
  BrandingConfig,
  ExportLayout,
  GenerationSettings,
  Region,
  RoomDefinition,
  RoomObject,
  RoomTemplate,
  SeatingCenter,
  SeatingProject,
  SeatingRule,
  Student,
} from './types';

const rotationSchema = z.union([
  z.literal(0),
  z.literal(90),
  z.literal(180),
  z.literal(270),
]);

const pointSchema = z.object({ x: z.number(), y: z.number() });

const idSchema = z.string().min(1);

// ---------------------------------------------------------------------------
// Room
// ---------------------------------------------------------------------------

const gridSchema = z.object({
  size: z.number().positive(),
  visible: z.boolean(),
  snap: z.boolean(),
});

const seatSchema = z.object({
  id: idSchema,
  centerId: idSchema,
  x: z.number(),
  y: z.number(),
  rotation: rotationSchema,
  label: z.string().optional(),
  enabled: z.boolean(),
  tags: z.array(z.string()).optional(),
  deskShape: z.enum(['rectangle', 'trapezoid']).optional(),
});

const centerSchema = z.object({
  id: idSchema,
  name: z.string().optional(),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  rotation: rotationSchema,
  seats: z.array(seatSchema),
  tags: z.array(z.string()).optional(),
  locked: z.boolean().optional(),
});

const roomObjectSchema = z.object({
  id: idSchema,
  type: z.enum([
    'board',
    'door',
    'teacherDesk',
    'waterFountain',
    'window',
    'cabinet',
    'custom',
  ]),
  name: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  rotation: rotationSchema,
  shape: z.enum(['rectangle', 'roundedRectangle', 'line', 'icon']),
  iconKey: z.string().optional(),
  tags: z.array(z.string()).optional(),
  visibleInExport: z.boolean(),
});

const regionSchema = z.object({
  id: idSchema,
  name: z.string(),
  geometry: z.union([
    z.object({
      type: z.literal('rectangle'),
      x: z.number(),
      y: z.number(),
      width: z.number().positive(),
      height: z.number().positive(),
    }),
    z.object({
      type: z.literal('polygon'),
      points: z.array(pointSchema).min(3),
    }),
  ]),
  visibleInEditor: z.boolean(),
  visibleInExport: z.boolean(),
});

const textLabelSchema = z.object({
  id: idSchema,
  text: z.string(),
  x: z.number(),
  y: z.number(),
  rotation: rotationSchema,
  fontSize: z.number().positive(),
  visibleInExport: z.boolean(),
});

export const roomDefinitionSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
  orientation: z.enum(['landscape', 'portrait']),
  grid: gridSchema,
  centers: z.array(centerSchema),
  objects: z.array(roomObjectSchema),
  regions: z.array(regionSchema),
  labels: z.array(textLabelSchema),
});

// ---------------------------------------------------------------------------
// Roster, rules, assignments
// ---------------------------------------------------------------------------

const studentSchema = z.object({
  id: idSchema,
  name: z.string(),
  displayName: z.string().optional(),
  notes: z.string().optional(),
  color: z.string().optional(),
});

const assignmentSchema = z.object({
  studentId: idSchema,
  seatId: idSchema,
  locked: z.boolean(),
});

const ruleBaseShape = {
  id: idSchema,
  enabled: z.boolean(),
  severity: z.enum(['required', 'preferred']),
  weight: z.number().min(0),
  label: z.string().optional(),
};

/** Relationship rules need at least two distinct students to mean anything. */
const studentSetSchema = z.array(idSchema).min(2);

const groupModeSchema = z.enum(['all', 'any']).optional();

export const seatingRuleSchema = z.discriminatedUnion('kind', [
  z.object({
    ...ruleBaseShape,
    kind: z.literal('studentInRegion'),
    studentId: idSchema,
    regionId: idSchema,
  }),
  z.object({
    ...ruleBaseShape,
    kind: z.literal('studentNotInRegion'),
    studentId: idSchema,
    regionId: idSchema,
  }),
  z.object({
    ...ruleBaseShape,
    kind: z.literal('studentNearObject'),
    studentId: idSchema,
    objectId: idSchema,
    maxDistance: z.number().nonnegative(),
  }),
  z.object({
    ...ruleBaseShape,
    kind: z.literal('studentFarFromObject'),
    studentId: idSchema,
    objectId: idSchema,
    minDistance: z.number().nonnegative(),
  }),
  z.object({
    ...ruleBaseShape,
    kind: z.literal('studentFixedSeat'),
    studentId: idSchema,
    seatId: idSchema,
  }),
  z.object({
    ...ruleBaseShape,
    kind: z.literal('pairSameCenter'),
    studentIds: studentSetSchema,
    groupMode: groupModeSchema,
  }),
  z.object({
    ...ruleBaseShape,
    kind: z.literal('pairDifferentCenter'),
    studentIds: studentSetSchema,
    groupMode: groupModeSchema,
  }),
  z.object({
    ...ruleBaseShape,
    kind: z.literal('pairNotAdjacentCenters'),
    studentIds: studentSetSchema,
    groupMode: groupModeSchema,
  }),
  z.object({
    ...ruleBaseShape,
    kind: z.literal('pairNear'),
    studentIds: studentSetSchema,
    maxDistance: z.number().nonnegative(),
    groupMode: groupModeSchema,
  }),
  z.object({
    ...ruleBaseShape,
    kind: z.literal('pairFar'),
    studentIds: studentSetSchema,
    minDistance: z.number().nonnegative(),
    groupMode: groupModeSchema,
  }),
  z.object({
    ...ruleBaseShape,
    kind: z.literal('pairMinimumDistance'),
    studentIds: studentSetSchema,
    minDistance: z.number().nonnegative(),
    groupMode: groupModeSchema,
  }),
]);

// ---------------------------------------------------------------------------
// Settings, branding, export, assets
// ---------------------------------------------------------------------------

export const generationSettingsSchema = z.object({
  seed: z.number().int().optional(),
  timeBudgetMs: z.number().positive(),
  attempts: z.number().int().positive(),
  diversityThreshold: z.number().min(0).max(1),
  nearDistance: z.number().nonnegative(),
  farDistance: z.number().nonnegative(),
  adjacentCenterDistance: z.number().nonnegative(),
});

export const brandingSchema = z.object({
  logoAssetId: z.string().optional(),
  primaryColor: z.string(),
  accentColor: z.string(),
  fontFamily: z.string(),
  showLogo: z.boolean(),
});

export const exportLayoutSchema = z.object({
  pageSize: z.enum(['A4', 'Letter']),
  orientation: z.enum(['portrait', 'landscape']),
  margin: z.number().nonnegative(),
  showRoomObjects: z.boolean(),
  showSeats: z.boolean(),
  showRegions: z.boolean(),
  showEmptySeats: z.boolean(),
  fontScale: z.number().positive(),
  nameStyle: z.enum(['full', 'firstName', 'firstNameLastInitial']),
  transparentBackground: z.boolean(),
  showHeader: z.boolean(),
  showFooter: z.boolean(),
  footerText: z.string().optional(),
});

const assetSchema = z.object({
  id: idSchema,
  name: z.string(),
  mimeType: z.string(),
  dataUrl: z.string(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
  byteSize: z.number().nonnegative(),
});

const metadataSchema = z.object({
  title: z.string().optional(),
  className: z.string().optional(),
  teacherName: z.string().optional(),
  schoolName: z.string().optional(),
  month: z.number().int().min(1).max(12).optional(),
  year: z.number().int().optional(),
  notes: z.string().optional(),
});

export const seatingProjectSchema = z.object({
  schemaVersion: z.number().int().positive(),
  id: idSchema,
  metadata: metadataSchema,
  room: roomDefinitionSchema,
  roster: z.array(studentSchema),
  rules: z.array(seatingRuleSchema),
  assignments: z.array(assignmentSchema),
  generation: generationSettingsSchema,
  branding: brandingSchema,
  exportLayout: exportLayoutSchema,
  assetStore: z.object({ assets: z.array(assetSchema) }),
  updatedAt: z.string(),
});

export const roomTemplateSchema = z.object({
  id: idSchema,
  name: z.string(),
  description: z.string().optional(),
  room: roomDefinitionSchema,
  branding: brandingSchema.optional(),
  exportLayout: exportLayoutSchema.optional(),
});

// ---------------------------------------------------------------------------
// Drift guards: the inferred shapes must still satisfy the domain interfaces.
// ---------------------------------------------------------------------------

export type SchemaDriftGuards = [
  AssertExtends<z.infer<typeof studentSchema>, Student>,
  AssertExtends<z.infer<typeof centerSchema>, SeatingCenter>,
  AssertExtends<z.infer<typeof roomObjectSchema>, RoomObject>,
  AssertExtends<z.infer<typeof regionSchema>, Region>,
  AssertExtends<z.infer<typeof roomDefinitionSchema>, RoomDefinition>,
  AssertExtends<z.infer<typeof seatingRuleSchema>, SeatingRule>,
  AssertExtends<z.infer<typeof generationSettingsSchema>, GenerationSettings>,
  AssertExtends<z.infer<typeof brandingSchema>, BrandingConfig>,
  AssertExtends<z.infer<typeof exportLayoutSchema>, ExportLayout>,
  AssertExtends<z.infer<typeof seatingProjectSchema>, SeatingProject>,
  AssertExtends<z.infer<typeof roomTemplateSchema>, RoomTemplate>,
];

// ---------------------------------------------------------------------------
// File envelope (TECHNICAL_SPEC §9.1)
// ---------------------------------------------------------------------------

export type DocumentKind = 'project' | 'room-template';

export const documentEnvelopeSchema = z.object({
  kind: z.enum(['project', 'room-template']),
  schemaVersion: z.number().int().positive(),
  appVersion: z.string().optional(),
  exportedAt: z.string(),
  payload: z.unknown(),
});

export type DocumentEnvelope = z.infer<typeof documentEnvelopeSchema>;

export { CURRENT_SCHEMA_VERSION };
