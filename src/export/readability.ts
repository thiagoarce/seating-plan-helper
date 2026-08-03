/**
 * Picks export settings that make student names legible on paper
 * (PRODUCT_SPEC §5.7).
 *
 * Names are drawn in room units and then shrunk by the page fit, so their real
 * size on paper is `11 × fontScale × fitScale`. Two knobs trade against each
 * other: a larger `fontScale` grows the text but makes it overflow the desk,
 * while a shorter `nameStyle` frees the width that buys that growth. Searching
 * both together is what lets a full classroom print readably at all — no single
 * setting gets there on its own.
 */

import type { SeatingProject } from '../domain/types';
import { buildSeatPresentations, planNameFontSize } from '../shared/RoomGraphics';
import { planFitScale } from './PlanDocument';

/** Point size a name should reach on paper before we stop shortening it. */
export const TARGET_NAME_POINTS = 9;

const NOMINAL_FONT_SIZE = 11;
const MIN_FONT_SCALE = 0.8;
const MAX_FONT_SCALE = 2;
const FONT_SCALE_STEP = 0.05;

/**
 * Name styles from most to least informative. The search stops at the first
 * one that reaches `TARGET_NAME_POINTS`, so names are only shortened as far as
 * legibility actually requires.
 */
const STYLE_PREFERENCE: SeatingProject['exportLayout']['nameStyle'][] = [
  'full',
  'firstNameLastInitial',
  'firstName',
];

export interface ReadableLayout {
  nameStyle: SeatingProject['exportLayout']['nameStyle'];
  fontScale: number;
  /** Resulting size of a name on the printed page, in points. */
  namePoints: number;
}

/**
 * Smallest `fontScale` that already reaches the size the desks allow.
 *
 * Names are capped by their desk, so past some point raising `fontScale`
 * changes nothing on paper. Returning that point rather than the maximum
 * keeps the stored setting honest about what it is doing.
 */
function bestScaleFor(
  project: SeatingProject,
  nameStyle: SeatingProject['exportLayout']['nameStyle'],
): { fontScale: number; drawnSize: number } {
  const studentNameById = new Map(project.roster.map((student) => [student.id, student.name]));
  const placement = new Map(project.assignments.map((item) => [item.studentId, item.seatId]));
  const seats = buildSeatPresentations(project.room, placement, studentNameById);

  let best = { fontScale: MIN_FONT_SCALE, drawnSize: 0 };
  for (
    let fontScale = MIN_FONT_SCALE;
    fontScale <= MAX_FONT_SCALE + 1e-9;
    fontScale += FONT_SCALE_STEP
  ) {
    const rounded = Math.round(fontScale * 100) / 100;
    const drawnSize = planNameFontSize(seats, nameStyle, rounded);
    if (drawnSize > best.drawnSize) best = { fontScale: rounded, drawnSize };
  }
  return best;
}

/**
 * Best combination of name style and text size for the current room and roster.
 *
 * Prefers keeping names whole: a shorter style is only chosen when the fuller
 * one cannot reach `TARGET_NAME_POINTS`. When nothing reaches the target, the
 * combination that gets largest on paper wins.
 */
export function suggestReadableLayout(project: SeatingProject): ReadableLayout {
  // Cropping is part of the fix, so measure against the framing we will apply.
  const cropped: SeatingProject = {
    ...project,
    exportLayout: { ...project.exportLayout, fitToContent: true },
  };
  const fitScale = planFitScale(cropped);

  let fallback: ReadableLayout | null = null;
  for (const nameStyle of STYLE_PREFERENCE) {
    const { fontScale, drawnSize } = bestScaleFor(cropped, nameStyle);
    const namePoints = drawnSize * fitScale;
    const candidate: ReadableLayout = { nameStyle, fontScale, namePoints };

    if (namePoints >= TARGET_NAME_POINTS) return candidate;
    if (!fallback || namePoints > fallback.namePoints) fallback = candidate;
  }

  return (
    fallback ?? { nameStyle: 'firstName', fontScale: 1, namePoints: NOMINAL_FONT_SIZE * fitScale }
  );
}
