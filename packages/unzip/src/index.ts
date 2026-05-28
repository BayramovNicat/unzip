import {
  findCentralDirectoryEntry,
  readCentralDirectory,
  readCentralDirectoryEntries,
} from './central-directory'
import { extractEntries, extractEntry } from './extract'
import { isSelectorArray, matchesAnyEntry } from './selectors'
import { readSourceCentralDirectory } from './source'
import type { CentralDirectory, ZipEntry, ZipEntrySelection, ZipEntrySelector, ZipSource } from './types'

export type { ZipEntry, ZipEntrySelector, ZipSource } from './types'

/**
 * Lists and extracts every non-directory entry from ZIP bytes.
 *
 * Entries are returned in archive order. File-level extraction failures are
 * stored on the affected `ZipEntry.error`; malformed archive structures throw.
 */
export async function unzip(bytes: Uint8Array): Promise<ZipEntry[]> {
  const entries = listZipEntries(bytes)

  await extractEntries(bytes, entries)
  return entries
}

/**
 * Lists ZIP entries from bytes without extracting file data.
 *
 * Returned entries include metadata only. Invalid ZIP input or malformed
 * central-directory data throws.
 */
export function listZipEntries(bytes: Uint8Array): ZipEntry[] {
  return readCentralDirectoryEntries(readCentralDirectory(bytes))
}

/**
 * Finds the first ZIP entry matching a selector without extracting file data.
 *
 * Returns `undefined` when no entry matches.
 */
export function findZipEntry(bytes: Uint8Array, selector: ZipEntrySelector): ZipEntry | undefined {
  return findCentralDirectoryEntry(readCentralDirectory(bytes), selector)
}

/**
 * Finds and extracts the first matching entry from bytes or a Blob.
 *
 * Returns `undefined` when no entry matches. Directory entries are returned
 * without file data. File-level extraction failures are returned as
 * `ZipEntry.error`.
 */
export async function extractZipEntry(source: ZipSource, selector: ZipEntrySelector): Promise<ZipEntry | undefined>
/**
 * Finds and extracts every entry matching any selector from bytes or a Blob.
 *
 * Results are returned in archive order. Missing selectors are skipped.
 * Directory entries are returned without file data. File-level extraction
 * failures are returned as `ZipEntry.error`.
 */
export async function extractZipEntry(source: ZipSource, selector: readonly ZipEntrySelector[]): Promise<ZipEntry[]>
export async function extractZipEntry(
  source: ZipSource,
  selector: ZipEntrySelection,
): Promise<ZipEntry | ZipEntry[] | undefined> {
  const centralDirectory = await readSourceCentralDirectory(source)

  if (isSelectorArray(selector)) {
    return extractSelectedEntries(source, centralDirectory, selector)
  }

  const entry = findCentralDirectoryEntry(centralDirectory, selector)
  await extractEntry(source, entry)
  return entry
}

async function extractSelectedEntries(
  source: ZipSource,
  centralDirectory: CentralDirectory,
  selectors: readonly ZipEntrySelector[],
): Promise<ZipEntry[]> {
  if (selectors.length === 0) {
    return []
  }

  const entries = readCentralDirectoryEntries(centralDirectory, (entry) => matchesAnyEntry(entry, selectors))

  await extractEntries(source, entries)
  return entries
}
