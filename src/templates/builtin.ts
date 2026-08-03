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
import { buildCenterGrid, buildDepthBands, buildObject, buildTrapezoidRow } from './builders';

/**
 * Curated to the arrangements teachers actually reach for by grade band
 * (PRODUCT_SPEC §5.1): trapezoid groups of 4 turned perpendicular to the
 * board for younger grades, rectangular blocks of 4 for middle grades, and
 * pairs or aligned rows for older students.
 */
export type TemplateId = 'blank' | 'rows' | 'pairs' | 'groups-of-four' | 'trapezoid-groups';

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

/**
 * Groups of 4 trapezoid desks (§ `buildTrapezoidRow`), each block turned 90°
 * so it stands perpendicular to the board rather than running along it — the
 * arrangement younger grades' trapezoid tables actually get pushed into.
 */
function trapezoidGroupsRoom(catalog: MessageCatalog): RoomDefinition {
  const room = baseRoom(catalog);
  const namePrefix = formatMessage(catalog, 'template.namePrefix.group');
  // Unrotated footprint of a 4-desk row: width ~207.8, height 80. Positions
  // are chosen so the *rotated* (90°) bounding box — 80 wide, ~207.8 tall —
  // clears the board/teacher desk up top and the door at bottom-right.
  const centers = [
    { x: 300, y: 250 },
    { x: 600, y: 250 },
    { x: 900, y: 250 },
    { x: 300, y: 570 },
    { x: 600, y: 570 },
    { x: 900, y: 570 },
  ];
  room.centers = centers.map((center, index) => {
    const width = 207.8;
    const height = 80;
    return buildTrapezoidRow({
      id: `tg${index + 1}`,
      name: `${namePrefix} ${index + 1}`,
      x: center.x - width / 2,
      y: center.y - height / 2,
      count: 4,
      rotation: 90,
    });
  });
  return room;
}

const BUILDERS: Record<TemplateId, (catalog: MessageCatalog) => RoomDefinition> = {
  blank: baseRoom,
  rows: rowsRoom,
  pairs: pairsRoom,
  'groups-of-four': groupsOfFourRoom,
  'trapezoid-groups': trapezoidGroupsRoom,
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
    id: 'trapezoid-groups',
    nameKey: 'template.trapezoidGroups.name',
    descriptionKey: 'template.trapezoidGroups.description',
    seatCount: 24,
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
