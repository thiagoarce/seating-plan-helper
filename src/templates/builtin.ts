/**
 * Built-in room templates (PRODUCT_SPEC §5.1, §6).
 *
 * Templates are immutable starting points: the app always hands the editor a
 * deep copy, so customizing one never edits the shipped definition. Their
 * labels come from the message catalog rather than being baked in, because
 * template names are user-visible copy.
 */

import { DEFAULT_GRID_SIZE, DEFAULT_ROOM_HEIGHT, DEFAULT_ROOM_WIDTH } from '../domain/defaults';
import type { RoomDefinition, RoomTemplate } from '../domain/types';
import type { MessageCatalog } from '../i18n/format';
import { formatMessage } from '../i18n/format';
import {
  buildCenter,
  buildCenterGrid,
  buildDepthBands,
  buildObject,
  buildTrapezoidFlower,
  buildTrapezoidHexagon,
  buildTrapezoidRow,
} from './builders';

export type TemplateId =
  | 'blank'
  | 'rows'
  | 'pairs'
  | 'groups-of-four'
  | 'mixed'
  | 'organic-islands'
  | 'trapezoid-flower'
  | 'trapezoid-hexagon'
  | 'trapezoid-parallelogram';

export interface TemplateDescriptor {
  id: TemplateId;
  nameKey: string;
  descriptionKey: string;
  seatCount: number;
}

const WIDTH = DEFAULT_ROOM_WIDTH;
const HEIGHT = DEFAULT_ROOM_HEIGHT;

function baseRoom(catalog: MessageCatalog): RoomDefinition {
  return {
    width: WIDTH,
    height: HEIGHT,
    orientation: 'landscape',
    grid: { size: DEFAULT_GRID_SIZE, visible: true, snap: true },
    centers: [],
    objects: [
      buildObject('board', 'board', formatMessage(catalog, 'object.board'), {
        x: WIDTH / 2 - 200,
        y: 24,
        width: 400,
        height: 24,
      }),
      buildObject(
        'teacher-desk',
        'teacherDesk',
        formatMessage(catalog, 'object.teacherDesk'),
        { x: WIDTH / 2 - 70, y: 74, width: 140, height: 60 },
      ),
      buildObject('door', 'door', formatMessage(catalog, 'object.door'), {
        x: WIDTH - 40,
        y: HEIGHT - 160,
        width: 24,
        height: 100,
      }),
    ],
    regions: buildDepthBands(WIDTH, HEIGHT, {
      front: formatMessage(catalog, 'region.front'),
      middle: formatMessage(catalog, 'region.middle'),
      back: formatMessage(catalog, 'region.back'),
    }),
    labels: [],
  };
}

function rowsRoom(catalog: MessageCatalog): RoomDefinition {
  const room = baseRoom(catalog);
  room.centers = buildCenterGrid({
    columns: 5,
    rows: 5,
    seatsPerCenter: 1,
    seatColumns: 1,
    originX: 190,
    originY: 190,
    gapX: 90,
    gapY: 40,
    idPrefix: 'd',
    namePrefix: formatMessage(catalog, 'template.namePrefix.desk'),
  });
  return room;
}

function pairsRoom(catalog: MessageCatalog): RoomDefinition {
  const room = baseRoom(catalog);
  room.centers = buildCenterGrid({
    columns: 3,
    rows: 4,
    seatsPerCenter: 2,
    seatColumns: 2,
    originX: 180,
    originY: 190,
    gapX: 120,
    gapY: 50,
    idPrefix: 'p',
    namePrefix: formatMessage(catalog, 'template.namePrefix.pair'),
  });
  return room;
}

function groupsOfFourRoom(catalog: MessageCatalog): RoomDefinition {
  const room = baseRoom(catalog);
  room.centers = buildCenterGrid({
    columns: 3,
    rows: 2,
    seatsPerCenter: 4,
    seatColumns: 2,
    originX: 200,
    originY: 220,
    gapX: 160,
    gapY: 120,
    namePrefix: formatMessage(catalog, 'template.namePrefix.group'),
    idPrefix: 'q',
  });
  return room;
}

/** A U-shape of pairs around two islands of four, for discussion-style rooms. */
function mixedRoom(catalog: MessageCatalog): RoomDefinition {
  const room = baseRoom(catalog);
  room.centers = [
    buildCenter({ id: 'left1', name: 'A', x: 120, y: 220, seatCount: 2, columns: 1 }),
    buildCenter({ id: 'left2', name: 'B', x: 120, y: 420, seatCount: 2, columns: 1 }),
    buildCenter({ id: 'island1', name: 'C', x: 380, y: 250, seatCount: 4, columns: 2 }),
    buildCenter({ id: 'island2', name: 'D', x: 640, y: 250, seatCount: 4, columns: 2 }),
    buildCenter({ id: 'right1', name: 'E', x: 960, y: 220, seatCount: 2, columns: 1 }),
    buildCenter({ id: 'right2', name: 'F', x: 960, y: 420, seatCount: 2, columns: 1 }),
    buildCenter({ id: 'back1', name: 'G', x: 380, y: 560, seatCount: 3, columns: 3 }),
    buildCenter({ id: 'back2', name: 'H', x: 700, y: 560, seatCount: 3, columns: 3 }),
  ];
  return room;
}

/**
 * Six islands of four placed at hand-picked, non-grid positions, matching how
 * real classrooms actually get arranged (islands nudged into whatever gaps
 * the room's fixed furniture leaves) rather than a perfectly even grid.
 */
function organicIslandsRoom(catalog: MessageCatalog): RoomDefinition {
  const room = baseRoom(catalog);
  const namePrefix = formatMessage(catalog, 'template.namePrefix.island');
  const positions = [
    { x: 90, y: 160 },
    { x: 330, y: 110 },
    { x: 600, y: 170 },
    { x: 860, y: 260 },
    { x: 200, y: 430 },
    { x: 520, y: 480 },
  ];
  room.centers = positions.map((position, index) =>
    buildCenter({
      id: `isl${index + 1}`,
      name: `${namePrefix} ${index + 1}`,
      x: position.x,
      y: position.y,
      seatCount: 4,
      columns: 2,
    }),
  );
  return room;
}

/**
 * Trapezoid-desk "flower" pods (§ `buildTrapezoidFlower`), the closest
 * quarter-turn-compatible approximation of hexagonal collaborative desk sets.
 */
function trapezoidFlowerRoom(catalog: MessageCatalog): RoomDefinition {
  const room = baseRoom(catalog);
  const namePrefix = formatMessage(catalog, 'template.namePrefix.flower');
  const positions = [
    { x: 200, y: 180 },
    { x: 600, y: 180 },
    { x: 200, y: 480 },
    { x: 600, y: 480 },
    { x: 1000, y: 330 },
  ];
  room.centers = positions.map((position, index) =>
    buildTrapezoidFlower({
      id: `flower${index + 1}`,
      name: `${namePrefix} ${index + 1}`,
      x: position.x,
      y: position.y,
    }),
  );
  return room;
}

/** Four hexagon pods (§ `buildTrapezoidHexagon`) — true 60° trapezoid fans. */
function trapezoidHexagonRoom(catalog: MessageCatalog): RoomDefinition {
  const room = baseRoom(catalog);
  const namePrefix = formatMessage(catalog, 'template.namePrefix.hexagon');
  const positions = [
    { x: 60, y: 140 },
    { x: 620, y: 140 },
    { x: 60, y: 460 },
    { x: 620, y: 460 },
  ];
  room.centers = positions.map((position, index) =>
    buildTrapezoidHexagon({
      id: `hex${index + 1}`,
      name: `${namePrefix} ${index + 1}`,
      x: position.x,
      y: position.y,
    }),
  );
  return room;
}

/**
 * Rows of trapezoid desks tiled into parallelogram-shaped clusters
 * (§ `buildTrapezoidRow`) — the arrangement teachers reach for more often
 * than the flower or hexagon fans.
 */
function trapezoidParallelogramRoom(catalog: MessageCatalog): RoomDefinition {
  const room = baseRoom(catalog);
  const namePrefix = formatMessage(catalog, 'template.namePrefix.trapezoidRow');
  const ys = [160, 300, 440, 580];
  room.centers = ys.map((y, index) =>
    buildTrapezoidRow({
      id: `prow${index + 1}`,
      name: `${namePrefix} ${index + 1}`,
      x: 475,
      y,
      count: 5,
    }),
  );
  return room;
}

const BUILDERS: Record<TemplateId, (catalog: MessageCatalog) => RoomDefinition> = {
  blank: baseRoom,
  rows: rowsRoom,
  pairs: pairsRoom,
  'groups-of-four': groupsOfFourRoom,
  mixed: mixedRoom,
  'organic-islands': organicIslandsRoom,
  'trapezoid-flower': trapezoidFlowerRoom,
  'trapezoid-hexagon': trapezoidHexagonRoom,
  'trapezoid-parallelogram': trapezoidParallelogramRoom,
};

export const TEMPLATE_DESCRIPTORS: TemplateDescriptor[] = [
  {
    id: 'groups-of-four',
    nameKey: 'template.groupsOfFour.name',
    descriptionKey: 'template.groupsOfFour.description',
    seatCount: 24,
  },
  {
    id: 'pairs',
    nameKey: 'template.pairs.name',
    descriptionKey: 'template.pairs.description',
    seatCount: 24,
  },
  {
    id: 'rows',
    nameKey: 'template.rows.name',
    descriptionKey: 'template.rows.description',
    seatCount: 25,
  },
  {
    id: 'mixed',
    nameKey: 'template.mixed.name',
    descriptionKey: 'template.mixed.description',
    seatCount: 22,
  },
  {
    id: 'organic-islands',
    nameKey: 'template.organicIslands.name',
    descriptionKey: 'template.organicIslands.description',
    seatCount: 24,
  },
  {
    id: 'trapezoid-flower',
    nameKey: 'template.trapezoidFlower.name',
    descriptionKey: 'template.trapezoidFlower.description',
    seatCount: 20,
  },
  {
    id: 'trapezoid-hexagon',
    nameKey: 'template.trapezoidHexagon.name',
    descriptionKey: 'template.trapezoidHexagon.description',
    seatCount: 24,
  },
  {
    id: 'trapezoid-parallelogram',
    nameKey: 'template.trapezoidParallelogram.name',
    descriptionKey: 'template.trapezoidParallelogram.description',
    seatCount: 20,
  },
  {
    id: 'blank',
    nameKey: 'template.blank.name',
    descriptionKey: 'template.blank.description',
    seatCount: 0,
  },
];

/** Always returns a fresh room; built-in templates are never handed out by reference. */
export function createRoomFromTemplate(id: TemplateId, catalog: MessageCatalog): RoomDefinition {
  const build = BUILDERS[id];
  return structuredClone(build(catalog));
}

export function createTemplate(id: TemplateId, catalog: MessageCatalog): RoomTemplate {
  const descriptor = TEMPLATE_DESCRIPTORS.find((item) => item.id === id);
  return {
    id: `builtin-${id}`,
    name: formatMessage(catalog, descriptor?.nameKey ?? id),
    description: formatMessage(catalog, descriptor?.descriptionKey ?? ''),
    room: createRoomFromTemplate(id, catalog),
  };
}
