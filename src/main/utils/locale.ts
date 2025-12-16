import { app } from 'electron'
import { locales } from './locales'

let translations: Record<string, any> = {}
let currentLocale = 'zh-CN'

function findBestLocale(locale: string): string {
  if (!locale) return 'en-US'
  const cleaned = locale.replace('_', '-')
  const exact = Object.keys(locales).find(l => l.toLowerCase() === cleaned.toLowerCase())
  if (exact) return exact
  const parts = cleaned.split('-')
  const lang = parts[0].toLowerCase()
  if (lang === 'zh') {
    const region = (parts[1] || '').toLowerCase()
    if (region.includes('tw') || region.includes('hant') || region.includes('hk')) {
      return Object.keys(locales).find(l => l.toLowerCase() === 'zh-tw') ?? 'zh-CN'
    }
    return Object.keys(locales).find(l => l.toLowerCase() === 'zh-cn') ?? 'zh-CN'
  }
  const pref = Object.keys(locales).find(l => l.toLowerCase().startsWith(`${lang}-`))
  if (pref) return pref
  const anyLang = Object.keys(locales).find(l => l.split('-')[0].toLowerCase() === lang)
  if (anyLang) return anyLang
  return 'en-US'
}

export function initLocale() {
  try {
    const locale = app.getLocale()
    currentLocale = findBestLocale(locale)
    translations = (locales as any)[currentLocale]?.translation ?? {}
  } catch (error) {
    console.warn('Failed to load translations:', error)
    translations = {}
  }
}

export function t(key: string, options?: Record<string, string | number>): string {
  const keys = key.split('.')
  let value: any = translations
  for (const k of keys) {
    value = value?.[k]
    if (value == null) break
  }
  if (typeof value !== 'string') {
    return key
  }
  if (options) {
    for (const [placeholder, replacement] of Object.entries(options)) {
      value = value.replace(new RegExp(`{{\\s*${placeholder}\\s*}}`, 'g'), String(replacement))
    }
  }
  return value
}

export function getLocale() {
  return currentLocale
}