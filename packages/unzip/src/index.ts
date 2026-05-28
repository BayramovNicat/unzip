import {
  centralDirectorySignature,
  endOfCentralDirectoryLength,
  eocdSignature,
  localFileSignature,
  maxCommentLength,
} from './constants'
import type {
  CentralDirectory,
  NodeZlib,
  ReadSlice,
  ZipEntry,
  ZipEntrySelection,
  ZipEntrySelector,
  ZipSource,
} from './types'

export type { ZipEntry, ZipEntrySelector, ZipSource } from './types'

const decoder = new TextDecoder()
let nodeZlibPromise: Promise<NodeZlib | undefined> | undefined

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

function readSourceCentralDirectory(source: ZipSource): CentralDirectory | Promise<CentralDirectory> {
  return isBlob(source) ? readBlobCentralDirectory(source) : readCentralDirectory(source)
}

function readCentralDirectory(bytes: Uint8Array): CentralDirectory {
  const view = toView(bytes)
  const eocdOffset = findEndOfCentralDirectory(view)

  return {
    bytes,
    totalEntries: view.getUint16(eocdOffset + 10, true),
    offset: view.getUint32(eocdOffset + 16, true),
  }
}

function readCentralDirectoryEntries(
  centralDirectory: CentralDirectory,
  predicate?: (entry: ZipEntry) => boolean,
): ZipEntry[] {
  const entries: ZipEntry[] = []
  const view = toView(centralDirectory.bytes)
  let offset = centralDirectory.offset

  for (let index = 0; index < centralDirectory.totalEntries; index += 1) {
    const { entry, nextOffset } = readCentralDirectoryEntry(centralDirectory.bytes, view, offset)

    if (!predicate || predicate(entry)) {
      entries.push(entry)
    }

    offset = nextOffset
  }

  return entries
}

function findCentralDirectoryEntry(
  centralDirectory: CentralDirectory,
  selector: ZipEntrySelector,
): ZipEntry | undefined {
  const view = toView(centralDirectory.bytes)
  let offset = centralDirectory.offset

  for (let index = 0; index < centralDirectory.totalEntries; index += 1) {
    const { entry, nextOffset } = readCentralDirectoryEntry(centralDirectory.bytes, view, offset)

    if (matchesEntry(entry, selector)) {
      return entry
    }

    offset = nextOffset
  }

  return undefined
}

function readCentralDirectoryEntry(
  bytes: Uint8Array,
  view: DataView,
  offset: number,
): { entry: ZipEntry; nextOffset: number } {
  if (view.getUint32(offset, true) !== centralDirectorySignature) {
    throw new Error('The ZIP central directory is malformed.')
  }

  const method = view.getUint16(offset + 10, true)
  const compressedSize = view.getUint32(offset + 20, true)
  const uncompressedSize = view.getUint32(offset + 24, true)
  const nameLength = view.getUint16(offset + 28, true)
  const extraLength = view.getUint16(offset + 30, true)
  const commentLength = view.getUint16(offset + 32, true)
  const localHeaderOffset = view.getUint32(offset + 42, true)
  const nameStart = offset + 46
  const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength))

  return {
    entry: {
      name,
      compressedSize,
      uncompressedSize,
      method,
      localHeaderOffset,
      isDirectory: name.endsWith('/'),
    },
    nextOffset: nameStart + nameLength + extraLength + commentLength,
  }
}

async function extractEntries(source: ZipSource, entries: ZipEntry[]): Promise<void> {
  await Promise.all(entries.map((entry) => extractEntry(source, entry)))
}

async function extractEntry(source: ZipSource, entry: ZipEntry | undefined): Promise<void> {
  if (!entry || entry.isDirectory) {
    return
  }

  try {
    setEntryBytes(entry, await extractEntryBytes(entry, readSourceSlice(source)))
  } catch (error) {
    entry.error = error instanceof Error ? error.message : 'Could not extract this file.'
  }
}

async function extractEntryBytes(
  entry: ZipEntry,
  read: ReadSlice,
): Promise<Uint8Array> {
  const offset = entry.localHeaderOffset
  const fixedHeader = await read(offset, offset + 30)
  const fixedHeaderView = toView(fixedHeader)

  if (fixedHeaderView.getUint32(0, true) !== localFileSignature) {
    throw new Error('Local file header is missing.')
  }

  const nameLength = fixedHeaderView.getUint16(26, true)
  const extraLength = fixedHeaderView.getUint16(28, true)
  const dataStart = entry.localHeaderOffset + 30 + nameLength + extraLength
  const dataEnd = dataStart + entry.compressedSize
  const compressed = await read(dataStart, dataEnd)

  if (entry.method === 0) {
    return copyUint8Array(compressed)
  }

  if (entry.method === 8) {
    return inflateRaw(compressed)
  }

  throw new Error(`Compression method ${entry.method} is not supported.`)
}

function readSourceSlice(source: ZipSource): ReadSlice {
  return isBlob(source) ? (start, end) => readBlobSlice(source, start, end) : (start, end) => source.subarray(start, end)
}

function matchesEntry(entry: ZipEntry, selector: ZipEntrySelector): boolean {
  if (typeof selector === 'string') {
    return entry.name === selector
  }

  if (selector instanceof RegExp) {
    selector.lastIndex = 0
    return selector.test(entry.name)
  }

  return selector(entry)
}

function matchesAnyEntry(entry: ZipEntry, selectors: readonly ZipEntrySelector[]): boolean {
  return selectors.some((selector) => matchesEntry(entry, selector))
}

function isSelectorArray(selector: ZipEntrySelection): selector is readonly ZipEntrySelector[] {
  return Array.isArray(selector)
}

async function readBlobCentralDirectory(blob: Blob): Promise<CentralDirectory> {
  const tailLength = Math.min(blob.size, maxCommentLength + endOfCentralDirectoryLength)
  const tailStart = blob.size - tailLength
  const tail = await readBlobSlice(blob, tailStart, blob.size)
  const tailView = toView(tail)
  const eocdOffset = findEndOfCentralDirectory(tailView)
  const totalEntries = tailView.getUint16(eocdOffset + 10, true)
  const centralDirectorySize = tailView.getUint32(eocdOffset + 12, true)
  const centralDirectoryOffset = tailView.getUint32(eocdOffset + 16, true)

  return {
    bytes: await readBlobSlice(blob, centralDirectoryOffset, centralDirectoryOffset + centralDirectorySize),
    totalEntries,
    offset: 0,
  }
}

async function readBlobSlice(blob: Blob, start: number, end: number): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer())
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const backendInflated = await inflateRawWithNode(bytes)

  if (backendInflated) {
    return backendInflated
  }

  const browserInflated = await inflateRawWithCompressionStream(bytes)

  if (browserInflated) {
    return browserInflated
  }

  throw new Error('This runtime does not support native decompression.')
}

async function inflateRawWithCompressionStream(bytes: Uint8Array): Promise<Uint8Array | undefined> {
  if (
    !hasBlobConstructor() ||
    !('DecompressionStream' in globalThis) ||
    !('Response' in globalThis)
  ) {
    return undefined
  }

  try {
    const stream = new Blob([copyBytes(bytes)]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  } catch {
    return undefined
  }
}

async function inflateRawWithNode(bytes: Uint8Array): Promise<Uint8Array | undefined> {
  const zlib = await loadNodeZlib()

  if (!zlib) {
    return undefined
  }

  return new Promise<Uint8Array>((resolve, reject) => {
    zlib.inflateRaw(copyUint8Array(bytes), (error, data) => {
      if (error) {
        reject(error)
        return
      }

      resolve(copyUint8Array(data))
    })
  })
}

async function loadNodeZlib(): Promise<NodeZlib | undefined> {
  nodeZlibPromise ??= importNodeZlib()
  return nodeZlibPromise
}

async function importNodeZlib(): Promise<NodeZlib | undefined> {
  const specifier = 'node:zlib'

  try {
    return (await import(/* @vite-ignore */ specifier)) as NodeZlib
  } catch {
    return undefined
  }
}

function setEntryBytes(entry: ZipEntry, bytes: Uint8Array): void {
  entry.bytes = bytes

  if (canCreateEntryBlob()) {
    entry.blob = new Blob([copyBytes(bytes)])
  }
}

function isBlob(source: ZipSource): source is Blob {
  return hasBlobConstructor() && source instanceof Blob
}

function hasBlobConstructor(): boolean {
  return typeof Blob !== 'undefined'
}

function canCreateEntryBlob(): boolean {
  return hasBlobConstructor() && typeof window !== 'undefined'
}

function findEndOfCentralDirectory(view: DataView): number {
  const minOffset = Math.max(0, view.byteLength - maxCommentLength - endOfCentralDirectoryLength)

  for (let offset = view.byteLength - endOfCentralDirectoryLength; offset >= minOffset; offset -= 1) {
    if (view.getUint32(offset, true) === eocdSignature) {
      return offset
    }
  }

  throw new Error('This does not look like a ZIP file.')
}

function toView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function copyBytes(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function copyUint8Array(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(copyBytes(bytes))
}
