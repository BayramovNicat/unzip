import { copyBytes, copyUint8Array, toView } from './bytes.js'
import { centralDirectorySignature, localFileSignature } from './constants.js'
import { BlobSourceReader, BytesSourceReader } from './source.js'
import type {
  CentralDirectory,
  NodeZlib,
  ZipEntry,
  ZipEntrySelector,
  ZipSource,
} from './types.js'

const decoder = new TextDecoder()
let nodeZlibPromise: Promise<NodeZlib | undefined> | undefined
type SourceReader = BytesSourceReader | BlobSourceReader

export class ZipArchive {
  private readonly source: SourceReader
  private readonly centralDirectory: CentralDirectory

  private constructor(source: SourceReader, centralDirectory: CentralDirectory) {
    this.source = source
    this.centralDirectory = centralDirectory
  }

  static fromBytes(bytes: Uint8Array): ZipArchive {
    const source = new BytesSourceReader(bytes)
    return new ZipArchive(source, source.readCentralDirectory())
  }

  static async fromSource(source: ZipSource): Promise<ZipArchive> {
    const reader = isBlob(source) ? new BlobSourceReader(source) : new BytesSourceReader(source)
    return new ZipArchive(reader, await reader.readCentralDirectory())
  }

  entries(predicate?: (entry: ZipEntry) => boolean): ZipEntry[] {
    const entries: ZipEntry[] = []

    this.eachEntry((entry) => {
      if (!predicate || predicate(entry)) {
        entries.push(entry)
      }
    })

    return entries
  }

  find(selector: ZipEntrySelector): ZipEntry | undefined {
    let match: ZipEntry | undefined

    this.eachEntry((entry) => {
      if (matchesEntry(entry, selector)) {
        match = entry
        return false
      }

      return true
    })

    return match
  }

  async extractSelected(selectors: readonly ZipEntrySelector[]): Promise<ZipEntry[]> {
    if (selectors.length === 0) {
      return []
    }

    const entries = this.entries((entry) => matchesAnyEntry(entry, selectors))

    await this.extract(entries)
    return entries
  }

  async extractFirst(selector: ZipEntrySelector): Promise<ZipEntry | undefined> {
    const entry = this.find(selector)

    await this.extractEntry(entry)
    return entry
  }

  async extract(entries: ZipEntry[]): Promise<void> {
    await Promise.all(entries.map((entry) => this.extractEntry(entry)))
  }

  private eachEntry(visitor: (entry: ZipEntry) => boolean | void): void {
    const view = toView(this.centralDirectory.bytes)
    let offset = this.centralDirectory.offset

    for (let index = 0; index < this.centralDirectory.totalEntries; index += 1) {
      const { entry, nextOffset } = readCentralDirectoryEntry(this.centralDirectory.bytes, view, offset)

      offset = nextOffset
      if (visitor(entry) === false) {
        return
      }
    }
  }

  private async extractEntry(entry: ZipEntry | undefined): Promise<void> {
    if (!entry || entry.isDirectory) {
      return
    }

    try {
      this.setEntryBytes(entry, await this.readEntryBytes(entry))
    } catch (error) {
      entry.error = error instanceof Error ? error.message : 'Could not extract this file.'
    }
  }

  private async readEntryBytes(entry: ZipEntry): Promise<Uint8Array> {
    const offset = entry.localHeaderOffset
    const fixedHeader = await this.source.read(offset, offset + 30)
    const fixedHeaderView = toView(fixedHeader)

    if (fixedHeaderView.getUint32(0, true) !== localFileSignature) {
      throw new Error('Local file header is missing.')
    }

    const nameLength = fixedHeaderView.getUint16(26, true)
    const extraLength = fixedHeaderView.getUint16(28, true)
    const dataStart = offset + 30 + nameLength + extraLength
    const compressed = await this.source.read(dataStart, dataStart + entry.compressedSize)

    if (entry.method === 0) {
      return copyUint8Array(compressed)
    }

    if (entry.method === 8) {
      return inflateRaw(compressed)
    }

    throw new Error(`Compression method ${entry.method} is not supported.`)
  }

  private setEntryBytes(entry: ZipEntry, bytes: Uint8Array): void {
    const blob = this.source.createBlob(bytes)

    entry.bytes = bytes
    if (blob) {
      entry.blob = blob
    }
  }
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

function isBlob(source: ZipSource): source is Blob {
  return typeof Blob !== 'undefined' && source instanceof Blob
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
    typeof Blob === 'undefined' ||
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
