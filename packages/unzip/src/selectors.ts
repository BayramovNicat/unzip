import type { ZipEntry, ZipEntrySelection, ZipEntrySelector } from './types'

export function matchesEntry(entry: ZipEntry, selector: ZipEntrySelector): boolean {
  if (typeof selector === 'string') {
    return entry.name === selector
  }

  if (selector instanceof RegExp) {
    selector.lastIndex = 0
    return selector.test(entry.name)
  }

  return selector(entry)
}

export function matchesAnyEntry(entry: ZipEntry, selectors: readonly ZipEntrySelector[]): boolean {
  return selectors.some((selector) => matchesEntry(entry, selector))
}

export function isSelectorArray(selector: ZipEntrySelection): selector is readonly ZipEntrySelector[] {
  return Array.isArray(selector)
}
