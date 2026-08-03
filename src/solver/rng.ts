/**
 * Seeded pseudo-random generator.
 *
 * Generation must be reproducible: the same seed and the same project always
 * produce the same suggestions (TECHNICAL_SPEC §7.5). `Math.random` cannot give
 * that, so every random decision in the solver goes through this generator.
 *
 * mulberry32 — small, fast, and good enough for shuffling and annealing.
 */

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [0, max). */
  int(max: number): number;
  /** Fisher-Yates shuffle, returning a new array. */
  shuffle<T>(items: readonly T[]): T[];
  pick<T>(items: readonly T[]): T | undefined;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (max: number): number => (max <= 0 ? 0 : Math.floor(next() * max));

  return {
    next,
    int,
    shuffle<T>(items: readonly T[]): T[] {
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = int(i + 1);
        const a = copy[i] as T;
        const b = copy[j] as T;
        copy[i] = b;
        copy[j] = a;
      }
      return copy;
    },
    pick<T>(items: readonly T[]): T | undefined {
      return items.length === 0 ? undefined : items[int(items.length)];
    },
  };
}

/** A non-deterministic seed, used when the project does not pin one. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}
