import { en } from './en';
import { hi } from './hi';

/** The shape every locale must satisfy — derived from the English table. */
export type Strings = typeof en;

/** Supported languages. */
export type Lang = 'en' | 'hi';

/** All locale tables, keyed by language code. */
export const dict: Record<Lang, Strings> = { en, hi };
