/**
 * Message catalog (TECHNICAL_SPEC §14).
 *
 * No component hard-codes user-visible copy. Domain modules emit
 * `MessageDescriptor` values and the UI resolves them here, so adding a locale
 * means adding a catalog file rather than touching components.
 */

import type { MessageDescriptor } from '../constraints/evaluation';

export type MessageCatalog = Record<string, string>;

export type LocaleCode = 'pt-BR';

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * Substitutes `{name}` placeholders. An unknown message id returns the id
 * itself, which makes a missing translation obvious in the UI instead of
 * rendering an empty string.
 */
export function formatMessage(
  catalog: MessageCatalog,
  id: string,
  values?: Record<string, string | number>,
): string {
  const template = catalog[id];
  if (template === undefined) return id;
  if (!values) return template;
  return template.replace(PLACEHOLDER, (match, key: string) => {
    const value = values[key];
    return value === undefined ? match : String(value);
  });
}

export function formatDescriptor(
  catalog: MessageCatalog,
  descriptor: MessageDescriptor,
): string {
  return formatMessage(catalog, descriptor.id, descriptor.values);
}

/** Locale-aware name sorting; user-entered names keep their accents. */
export function createNameCollator(locale: LocaleCode): Intl.Collator {
  return new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
}
