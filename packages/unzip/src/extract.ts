import { copyUint8Array } from './bytes'
import { canCreateEntryBlob, createEntryBlob } from './blob'
import { inflateRaw } from './inflate'
import { localFileSignature } from './constants'
import { readSourceSlice } from './source'
import { toView } from './bytes'
import type { ReadSlice, ZipEntry, ZipSource } from './types'

export async function extractEntries(source: ZipSource, entries: ZipEntry[]): Promise<void> {
  await Promise.all(entries.map((entry) => extractEntry(source, entry)))
}

export async function extractEntry(source: ZipSource, entry: ZipEntry | undefined): Promise<void> {
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

function setEntryBytes(entry: ZipEntry, bytes: Uint8Array): void {
  entry.bytes = bytes

  if (canCreateEntryBlob()) {
    entry.blob = createEntryBlob(bytes)
  }
}
