import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { DEFAULT_LOCALE, LocaleContext, getCatalog } from './i18n/useMessages';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element not found');

createRoot(container).render(
  <StrictMode>
    <LocaleContext.Provider value={{ locale: DEFAULT_LOCALE, catalog: getCatalog(DEFAULT_LOCALE) }}>
      <App />
    </LocaleContext.Provider>
  </StrictMode>,
);
