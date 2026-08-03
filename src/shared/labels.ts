/**
 * Human-friendly display text for centers and seats.
 *
 * `center.name` and `seat.label` are optional in the domain model (a center
 * built before this module existed, or hand-edited JSON, may still lack
 * them), so every call site falls back to the raw id rather than crashing.
 * The fallback is intentionally still visible as an ugly id — that is the
 * signal that a center predates friendly naming and could use a rename.
 */

import type { Seat, SeatingCenter } from '../domain/types';

export function centerDisplayName(center: SeatingCenter): string {
  return center.name?.trim() || center.id;
}

export function seatDisplayLabel(center: SeatingCenter, seat: Seat): string {
  const centerName = centerDisplayName(center);
  return seat.label ? `${centerName} · ${seat.label}` : `${centerName} · ${seat.id}`;
}
