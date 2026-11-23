import { en } from './en.js';
import { ko } from './ko.js';

export type Lang = 'en' | 'ko';
export type MessageKey = keyof typeof en;

export const MESSAGES: Record<Lang, Record<MessageKey, string>> = { en, ko };

export function isLang(value: unknown): value is Lang {
  return value === 'en' || value === 'ko';
}

function fromLocale(value: string | undefined): Lang | undefined {
  if (value === undefined || value === '') return undefined;
  return value.toLowerCase().startsWith('ko') ? 'ko' : 'en';
}

/**
 * Picks the output language. Order: --lang flag, LISTCHANGE_PROBE_LANG,
 * then the first non-empty of LC_ALL, LC_MESSAGES, LANG. Anything not starting with "ko" is English.
 */
export function resolveLang(flag: string | undefined, env: NodeJS.ProcessEnv): Lang {
  if (flag !== undefined) {
    if (!isLang(flag)) throw new Error(`Invalid language "${flag}". Use en or ko.`);
    return flag;
  }
  for (const value of [env.LISTCHANGE_PROBE_LANG, env.LC_ALL, env.LC_MESSAGES, env.LANG]) {
    const lang = fromLocale(value);
    if (lang) return lang;
  }
  return 'en';
}

export type Translator = (key: MessageKey, vars?: Record<string, string | number>) => string;

export function createTranslator(lang: Lang): Translator {
  const table = MESSAGES[lang];
  return (key, vars) => {
    const template = table[key];
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
  };
}
