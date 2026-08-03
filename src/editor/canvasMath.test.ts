import { describe, expect, it } from 'vitest';
import { ptBR } from '../i18n/pt-BR';
import { createRoomFromTemplate } from '../templates/builtin';
import {
  MIN_ITEM_SIZE,
  collectItemBounds,
  computeSnap,
  handlePosition,
  normalizeRect,
  rectsIntersect,
  resizeRect,
  rotateBy90,
  scaleSeatOffsets,
  selectionBounds,
  snapToGrid,
} from './canvasMath';

const options = { gridSize: 20, snapToGrid: true, threshold: 8 };

describe('snapToGrid', () => {
  it('rounds to the nearest multiple', () => {
    expect(snapToGrid(23, 20)).toBe(20);
    expect(snapToGrid(31, 20)).toBe(40);
  });

  it('is a no-op for a zero grid', () => {
    expect(snapToGrid(23, 0)).toBe(23);
  });
});

describe('computeSnap', () => {
  it('snaps to the grid when nothing is nearby', () => {
    const result = computeSnap({ x: 23, y: 47, width: 40, height: 40 }, [], options);
    expect(result.dx).toBe(-3);
    expect(result.dy).toBe(-7);
    expect(result.guides).toHaveLength(0);
  });

  it('aligns a left edge with another item and reports a guide', () => {
    const result = computeSnap(
      { x: 103, y: 300, width: 40, height: 40 },
      [{ x: 100, y: 0, width: 40, height: 40 }],
      options,
    );
    expect(result.dx).toBe(-3);
    expect(result.guides.some((guide) => guide.orientation === 'vertical')).toBe(true);
  });

  it('aligns midlines', () => {
    // Moved midline is at 122; the other item's midline is at 120.
    const result = computeSnap(
      { x: 102, y: 300, width: 40, height: 40 },
      [{ x: 100, y: 0, width: 40, height: 40 }],
      options,
    );
    expect(result.dx).toBe(-2);
  });

  it('ignores items beyond the threshold', () => {
    const result = computeSnap(
      { x: 300, y: 300, width: 40, height: 40 },
      [{ x: 100, y: 100, width: 40, height: 40 }],
      { ...options, snapToGrid: false },
    );
    expect(result.dx).toBe(0);
    expect(result.dy).toBe(0);
  });

  it('leaves the position alone when both snapping modes are off', () => {
    const result = computeSnap({ x: 23, y: 47, width: 40, height: 40 }, [], {
      ...options,
      snapToGrid: false,
    });
    expect(result.dx).toBe(0);
    expect(result.dy).toBe(0);
  });
});

describe('rectsIntersect', () => {
  it('detects overlap', () => {
    expect(
      rectsIntersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 }),
    ).toBe(true);
  });

  it('detects separation', () => {
    expect(
      rectsIntersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 0, width: 10, height: 10 }),
    ).toBe(false);
  });
});

describe('normalizeRect', () => {
  it('handles a drag towards the origin', () => {
    expect(normalizeRect({ x: 50, y: 60 }, { x: 10, y: 20 })).toEqual({
      x: 10,
      y: 20,
      width: 40,
      height: 40,
    });
  });
});

describe('rotateBy90', () => {
  it('advances a quarter turn', () => {
    expect(rotateBy90(0)).toBe(90);
    expect(rotateBy90(270)).toBe(0);
  });

  it('goes backwards', () => {
    expect(rotateBy90(0, -1)).toBe(270);
  });
});

describe('collectItemBounds', () => {
  it('covers centers, objects, regions, and labels', () => {
    const room = createRoomFromTemplate('groups-of-four', ptBR);
    const items = collectItemBounds(room);
    expect(items.filter((item) => item.key.startsWith('center:'))).toHaveLength(6);
    expect(items.filter((item) => item.key.startsWith('object:'))).toHaveLength(3);
    expect(items.filter((item) => item.key.startsWith('region:'))).toHaveLength(3);
  });

  it('honours the exclusion set', () => {
    const room = createRoomFromTemplate('groups-of-four', ptBR);
    const excluded = collectItemBounds(room, new Set(['center:q1']));
    expect(excluded.some((item) => item.key === 'center:q1')).toBe(false);
  });
});

describe('selectionBounds', () => {
  it('returns null for an empty selection', () => {
    expect(selectionBounds([])).toBeNull();
  });

  it('covers every item', () => {
    expect(
      selectionBounds([
        { key: 'a', bounds: { x: 0, y: 0, width: 10, height: 10 } },
        { key: 'b', bounds: { x: 30, y: 20, width: 10, height: 10 } },
      ]),
    ).toEqual({ x: 0, y: 0, width: 40, height: 30 });
  });
});

describe('handlePosition', () => {
  const bounds = { x: 10, y: 20, width: 100, height: 50 };

  it('places corner handles', () => {
    expect(handlePosition(bounds, 'nw')).toEqual({ x: 10, y: 20 });
    expect(handlePosition(bounds, 'se')).toEqual({ x: 110, y: 70 });
  });

  it('places edge handles at midpoints', () => {
    expect(handlePosition(bounds, 'n')).toEqual({ x: 60, y: 20 });
    expect(handlePosition(bounds, 'w')).toEqual({ x: 10, y: 45 });
  });
});

describe('resizeRect', () => {
  const bounds = { x: 100, y: 100, width: 100, height: 100 };

  it('grows from the south-east handle', () => {
    expect(resizeRect(bounds, 'se', 20, 30)).toEqual({
      x: 100,
      y: 100,
      width: 120,
      height: 130,
    });
  });

  it('keeps the opposite edge fixed when dragging north-west', () => {
    const result = resizeRect(bounds, 'nw', 20, 20);
    expect(result.x).toBe(120);
    expect(result.x + result.width).toBe(200);
  });

  it('never shrinks below the minimum size', () => {
    const result = resizeRect(bounds, 'nw', 500, 500);
    expect(result.width).toBeGreaterThanOrEqual(MIN_ITEM_SIZE);
    expect(result.height).toBeGreaterThanOrEqual(MIN_ITEM_SIZE);
  });

  it('only affects the axes the handle controls', () => {
    expect(resizeRect(bounds, 'e', 20, 40).height).toBe(100);
    expect(resizeRect(bounds, 's', 20, 40).width).toBe(100);
  });
});

describe('scaleSeatOffsets', () => {
  it('scales proportionally', () => {
    expect(
      scaleSeatOffsets([{ x: 20, y: 10 }], { width: 100, height: 100 }, { width: 200, height: 50 }),
    ).toEqual([{ x: 40, y: 5 }]);
  });

  it('is safe for a degenerate original size', () => {
    expect(
      scaleSeatOffsets([{ x: 20, y: 10 }], { width: 0, height: 0 }, { width: 100, height: 100 }),
    ).toEqual([{ x: 20, y: 10 }]);
  });
});
