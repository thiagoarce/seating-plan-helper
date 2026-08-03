/**
 * Collision-resistant local ids. Names and array indexes are never used as
 * identity (TECHNICAL_SPEC §4).
 */

const FALLBACK_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function fallbackId(): string {
  let out = '';
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  for (const byte of bytes) {
    out += FALLBACK_ALPHABET[byte % FALLBACK_ALPHABET.length];
  }
  return out;
}

export function createId(prefix?: string): string {
  const base =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : fallbackId();
  return prefix ? `${prefix}_${base}` : base;
}
