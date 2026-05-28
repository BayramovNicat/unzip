import { toView } from './bytes'
import {
  centralDirectorySignature,
  endOfCentralDirectoryLength,
  eocdSignature,
  maxCommentLength,
} from './constants'
import type { CentralDirectory, ZipEntry, ZipEntrySelector } from './types'
import { matchesEntry } from './selectors'

const decoder = new TextDecoder()

export function readCentralDirectory(bytes: Uint8Array): CentralDirectory {
  const { totalEntries, centralDirectoryOffset } = readEndOfCentralDirectory(bytes)

  return {
    bytes,
    totalEntries,
    offset: centralDirectoryOffset,
  }
}

export function readCentralDirectoryEntries(
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

export function findCentralDirectoryEntry(
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

export function readEndOfCentralDirectory(bytes: Uint8Array): {
  totalEntries: number
  centralDirectorySize: number
  centralDirectoryOffset: number
} {
  const view = toView(bytes)
  const eocdOffset = findEndOfCentralDirectory(view)

  return {
    totalEntries: view.getUint16(eocdOffset + 10, true),
    centralDirectorySize: view.getUint32(eocdOffset + 12, true),
    centralDirectoryOffset: view.getUint32(eocdOffset + 16, true),
  }
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
