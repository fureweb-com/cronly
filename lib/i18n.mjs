import en from './i18n/en.mjs'
import ko from './i18n/ko.mjs'
import ja from './i18n/ja.mjs'
import zh from './i18n/zh.mjs'

const catalogs = { en, ko, ja, zh }

export const SUPPORTED_LOCALES = ['en', 'ko', 'ja', 'zh']

let locale = 'en'

/**
 * Normalize a locale string like "ko_KR.UTF-8" → "ko".
 * Returns null if unsupported.
 */
export function normalizeLocale(input) {
  if (!input || typeof input !== 'string') return null
  const base = input.split(/[_.@-]/)[0].toLowerCase()
  return SUPPORTED_LOCALES.includes(base) ? base : null
}

/**
 * Detect the best locale from flags and environment variables.
 * Precedence: --lang > CRONLY_LANG > LC_ALL > LC_MESSAGES > LANG > en
 */
export function detectLocale(flags, env = process.env) {
  if (flags.lang) {
    const norm = normalizeLocale(flags.lang)
    if (norm) return norm
  }
  for (const key of ['CRONLY_LANG', 'LC_ALL', 'LC_MESSAGES', 'LANG']) {
    if (env[key]) {
      const norm = normalizeLocale(env[key])
      if (norm) return norm
    }
  }
  return 'en'
}

export function setLocale(l) {
  locale = l
}

export function getLocale() {
  return locale
}

/**
 * Translate a message key, with optional params for function-valued entries.
 * Falls back to English catalog, then returns the key itself.
 */
export function t(key, params) {
  const catalog = catalogs[locale] || catalogs.en
  let msg = catalog[key]
  if (msg === undefined) msg = catalogs.en[key]
  if (msg === undefined) return key
  return typeof msg === 'function' ? msg(params) : msg
}

/**
 * Get the full usage/help text in the current locale.
 */
export function getUsage() {
  return t('usage')
}
