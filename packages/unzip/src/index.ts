import { ZipArchive } from './archive.js'
import type { ZipEntry, ZipEntrySelection, ZipEntrySelector, ZipSource } from './types.js'

export type { ZipEntry, ZipEntrySelector, ZipSource } from './types.js'

/**
 * Lists and extracts every non-directory entry from ZIP bytes.
 *
 * Entries are returned in archive order. File-level extraction failures are
 * stored on the affected `ZipEntry.error`; malformed archive structures throw.
 */
export async function unzip(bytes: Uint8Array): Promise<ZipEntry[]> {
  const archive = ZipArchive.fromBytes(bytes)
  const entries = archive.entries()

  await archive.extract(entries)
  return entries
}

/**
 * Lists ZIP entries from bytes without extracting file data.
 *
 * Returned entries include metadata only. Invalid ZIP input or malformed
 * central-directory data throws.
 */
export function listZipEntries(bytes: Uint8Array): ZipEntry[] {
  return ZipArchive.fromBytes(bytes).entries()
}

/**
 * Finds the first ZIP entry matching a selector without extracting file data.
 *
 * Returns `undefined` when no entry matches.
 */
export function findZipEntry(bytes: Uint8Array, selector: ZipEntrySelector): ZipEntry | undefined {
  return ZipArchive.fromBytes(bytes).find(selector)
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
  const archive = await ZipArchive.fromSource(source)

  return isSelectorArray(selector) ? archive.extractSelected(selector) : archive.extractFirst(selector)
}

function isSelectorArray(selector: ZipEntrySelection): selector is readonly ZipEntrySelector[] {
  return Array.isArray(selector)
}
