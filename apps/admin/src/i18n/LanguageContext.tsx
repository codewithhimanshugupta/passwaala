import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { dict, type Lang, type Strings } from './strings';

const STORAGE_KEY = 'nearbaz.admin.lang';

/** Read the saved language (guarded for native/SSR), defaulting to English. */
function loadLang(): Lang {
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'en' || saved === 'hi') return saved;
    }
  } catch {
    /* storage unavailable — fall back to default */
  }
  return 'en';
}

function saveLang(lang: Lang): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* ignore */
  }
}

interface LanguageValue {
  lang: Lang;
  t: Strings;
  setLang: (lang: Lang) => void;
}

const LanguageContext = createContext<LanguageValue | null>(null);

/**
 * LanguageProvider — device-local language state. The chosen language persists
 * to localStorage, so a reload keeps it. Changing it re-renders the whole tree,
 * so every screen using `useLang()` updates immediately.
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(loadLang);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    saveLang(next);
  }, []);

  const value = useMemo<LanguageValue>(() => ({ lang, t: dict[lang], setLang }), [lang, setLang]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

/** Access the current language, its string table (`t`), and a setter. */
export function useLang(): LanguageValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLang must be used within a LanguageProvider');
  return ctx;
}
