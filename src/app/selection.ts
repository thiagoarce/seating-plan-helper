/**
 * Selection keys.
 *
 * Ids are only unique within their own collection, so the selection carries the
 * kind alongside the id. Encoding it as a single string keeps the selection a
 * plain `string[]`, which is cheap to compare in React.
 */

export type SelectableKind = 'center' | 'seat' | 'object' | 'region' | 'label';

export type SelectionKey = `${SelectableKind}:${string}`;

export function selectionKey(kind: SelectableKind, id: string): SelectionKey {
  return `${kind}:${id}`;
}

export function parseSelectionKey(key: string): { kind: SelectableKind; id: string } | null {
  const separator = key.indexOf(':');
  if (separator < 0) return null;
  const kind = key.slice(0, separator) as SelectableKind;
  const id = key.slice(separator + 1);
  if (!id) return null;
  return { kind, id };
}

export function keysOfKind(keys: readonly string[], kind: SelectableKind): string[] {
  const result: string[] = [];
  for (const key of keys) {
    const parsed = parseSelectionKey(key);
    if (parsed?.kind === kind) result.push(parsed.id);
  }
  return result;
}
