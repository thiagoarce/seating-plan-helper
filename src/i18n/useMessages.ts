import { createContext, useContext, useMemo } from 'react';
import type { MessageDescriptor } from '../constraints/evaluation';
import { createNameCollator, formatDescriptor, formatMessage } from './format';
import type { LocaleCode, MessageCatalog } from './format';
import { ptBR } from './pt-BR';

const CATALOGS: Record<LocaleCode, MessageCatalog> = {
  'pt-BR': ptBR,
};

export const DEFAULT_LOCALE: LocaleCode = 'pt-BR';

export interface LocaleContextValue {
  locale: LocaleCode;
  catalog: MessageCatalog;
}

export const LocaleContext = createContext<LocaleContextValue>({
  locale: DEFAULT_LOCALE,
  catalog: CATALOGS[DEFAULT_LOCALE],
});

export interface Messages {
  locale: LocaleCode;
  /** Formats a catalog key with optional `{placeholder}` values. */
  t: (id: string, values?: Record<string, string | number>) => string;
  /** Formats a descriptor produced by the domain layer. */
  m: (descriptor: MessageDescriptor) => string;
  collator: Intl.Collator;
}

export function useMessages(): Messages {
  const { locale, catalog } = useContext(LocaleContext);

  return useMemo(
    () => ({
      locale,
      t: (id, values) => formatMessage(catalog, id, values),
      m: (descriptor) => formatDescriptor(catalog, descriptor),
      collator: createNameCollator(locale),
    }),
    [locale, catalog],
  );
}

export function getCatalog(locale: LocaleCode): MessageCatalog {
  return CATALOGS[locale];
}
