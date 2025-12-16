import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

let translations: Record<string, any> = {}
let currentLocale = 'zh-cn'

export function initLocale() {
  try {
    const locale = app.getLocale()
    currentLocale = locale.startsWith('zh') ? 'zh-cn' : locale.startsWith('en') ? 'en-us' : 'zh-cn'
    
    const translationPath = join(__dirname, '../../renderer/src/i18n/locales', `${currentLocale}.json`)
    const translationContent = readFileSync(translationPath, 'utf-8')
    translations = JSON.parse(translationContent)
  } catch (error) {
    console.warn('Failed to load translations:', error)
    // Fallback to empty translations
    translations = {}
  }
}

export function t(key: string, options?: Record<string, string | number>): string {
  const keys = key.split('.')
  let value: any = translations
  
  for (const k of keys) {
    value = value?.[k]
  }
  
  if (typeof value !== 'string') {
    return key // Fallback to key if translation not found
  }
  
  // Replace variables in the translation
  if (options) {
    for (const [placeholder, replacement] of Object.entries(options)) {
      value = value.replace(new RegExp(`{{${placeholder}}}`, 'g'), String(replacement))
    }
  }
  
  return value
}

export function getLocale() {
  return currentLocale
}