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
  buildCenterGrid,
  buildDepthBands,
  buildObject,
  buildTrapezoidRow,
  centerFootprint,
  trapezoidRowFootprint,
} from './builders';

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

/**
 * Aisles between groups, kept tight on purpose. Wide gaps push the desks apart
 * and shrink every one of them on the printed page, taking the names with them
 * — spacing here buys nothing that legibility does not pay for.
 */
const AISLE_X = 40;
const AISLE_Y = 34;
/** Below the board and teacher desk, which occupy the top of every room. */
const SEATING_TOP = 170;

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
      // Beside the seating band rather than down in the far corner: the
      // export frames everything drawn, so an outlying object drags empty
      // floor into the crop and shrinks every name to pay for it.
      buildObject('door', 'door', formatMessage(catalog, 'object.door'), {
        x: WIDTH - 40,
        y: SEATING_TOP + 60,
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

/** Centres a grid of `count` blocks of `size`, spaced by `gap`. */
function centredOrigin(count: number, size: number, gap: number, span: number): number {
  return Math.max(0, Math.round((span - (count * size + (count - 1) * gap)) / 2));
}

function rowsRoom(catalog: MessageCatalog): RoomDefinition {
  const room = baseRoom(catalog);
  const { width } = centerFootprint(1, 1);
  room.centers = buildCenterGrid({
    columns: 5,
    rows: 5,
    seatsPerCenter: 1,
    seatColumns: 1,
    originX: centredOrigin(5, width, AISLE_X, WIDTH),
    originY: SEATING_TOP,
    gapX: AISLE_X,
    gapY: AISLE_Y,
    idPrefix: 'd',
    namePrefix: formatMessage(catalog, 'template.namePrefix.desk'),
  });
  return room;
}

function pairsRoom(catalog: MessageCatalog): RoomDefinition {
  const room = baseRoom(catalog);
  const { width } = centerFootprint(2, 2);
  room.centers = buildCenterGrid({
    columns: 3,
    rows: 4,
    seatsPerCenter: 2,
    seatColumns: 2,
    originX: centredOrigin(3, width, AISLE_X, WIDTH),
    originY: SEATING_TOP,
    gapX: AISLE_X,
    gapY: AISLE_Y,
    idPrefix: 'p',
    namePrefix: formatMessage(catalog, 'template.namePrefix.pair'),
  });
  return room;
}

function groupsOfFourRoom(catalog: MessageCatalog): RoomDefinition {
  const room = baseRoom(catalog);
  const { width } = centerFootprint(4, 2);
  room.centers = buildCenterGrid({
    columns: 3,
    rows: 2,
    seatsPerCenter: 4,
    seatColumns: 2,
    originX: centredOrigin(3, width, AISLE_X, WIDTH),
    originY: SEATING_TOP + 30,
    gapX: AISLE_X,
    gapY: AISLE_Y + 30,
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

  // Turned 90°, a row's bounding box swaps: narrow across, long down the room.
  // Six of them stand side by side in a single band below the board.
  const footprint = trapezoidRowFootprint(4);
  const slot = { width: footprint.height, height: footprint.width };
  const columns = 6;
  const originX = centredOrigin(columns, slot.width, AISLE_X, WIDTH);

  room.centers = Array.from({ length: columns }, (_, index) => {
    const slotX = originX + index * (slot.width + AISLE_X);
    // `x`/`y` describe the unrotated box; rotation pivots about its midpoint,
    // so convert from where the rotated box should land.
    const midX = slotX + slot.width / 2;
    const midY = SEATING_TOP + slot.height / 2;
    return buildTrapezoidRow({
      id: `tg${index + 1}`,
      name: `${namePrefix} ${index + 1}`,
      x: midX - footprint.width / 2,
      y: midY - footprint.height / 2,
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
