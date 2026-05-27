export type ZipEntry = {
  name: string
  compressedSize: number
  uncompressedSize: number
  method: number
  localHeaderOffset: number
  isDirectory: boolean
  bytes?: Uint8Array
  blob?: Blob
  error?: string
}

export type ZipEntrySelector = string | RegExp | ((entry: ZipEntry) => boolean)
export type ZipSource = Uint8Array | Blob
type NodeZlib = {
  inflateRaw(input: Uint8Array, callback: (error: Error | null, data: Uint8Array) => void): void
}

const decoder = new TextDecoder()
const maxCommentLength = 0xffff
const endOfCentralDirectoryLength = 22
const eocdSignature = 0x06054b50
const centralDirectorySignature = 0x02014b50
const localFileSignature = 0x04034b50

export async function unzip(bytes: Uint8Array): Promise<ZipEntry[]> {
  const entries = listZipEntries(bytes)

  for (const entry of entries) {
    if (!entry.isDirectory) {
      await extractIntoEntry(bytes, entry)
    }
  }

  return entries
}

export function listZipEntries(bytes: Uint8Array): ZipEntry[] {
  const view = toView(bytes)
  const eocdOffset = findEndOfCentralDirectory(view)
  const totalEntries = view.getUint16(eocdOffset + 10, true)
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true)
  const entries: ZipEntry[] = []
  let offset = centralDirectoryOffset

  for (let index = 0; index < totalEntries; index += 1) {
    const { entry, nextOffset } = readCentralDirectoryEntry(bytes, view, offset)
    entries.push(entry)
    offset = nextOffset
  }

  return entries
}

export function findZipEntry(bytes: Uint8Array, selector: ZipEntrySelector): ZipEntry | undefined {
  const view = toView(bytes)
  const eocdOffset = findEndOfCentralDirectory(view)
  const totalEntries = view.getUint16(eocdOffset + 10, true)
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true)
  let offset = centralDirectoryOffset

  for (let index = 0; index < totalEntries; index += 1) {
    const { entry, nextOffset } = readCentralDirectoryEntry(bytes, view, offset)

    if (matchesEntry(entry, selector)) {
      return entry
    }

    offset = nextOffset
  }

  return undefined
}

export async function extractZipEntry(source: ZipSource, selector: ZipEntrySelector): Promise<ZipEntry | undefined> {
  if (isBlob(source)) {
    return extractZipEntryFromBlob(source, selector)
  }

  const entry = findZipEntry(source, selector)

  if (!entry || entry.isDirectory) {
    return entry
  }

  await extractIntoEntry(source, entry)
  return entry
}

async function extractZipEntryFromBlob(blob: Blob, selector: ZipEntrySelector): Promise<ZipEntry | undefined> {
  const entry = await findZipEntryFromBlob(blob, selector)

  if (!entry || entry.isDirectory) {
    return entry
  }

  await extractBlobIntoEntry(blob, entry)
  return entry
}

function findEntryInCentralDirectory(
  bytes: Uint8Array,
  totalEntries: number,
  selector: ZipEntrySelector,
): ZipEntry | undefined {
  const view = toView(bytes)
  let offset = 0

  for (let index = 0; index < totalEntries; index += 1) {
    const { entry, nextOffset } = readCentralDirectoryEntry(bytes, view, offset)

    if (matchesEntry(entry, selector)) {
      return entry
    }

    offset = nextOffset
  }

  return undefined
}

async function findZipEntryFromBlob(blob: Blob, selector: ZipEntrySelector): Promise<ZipEntry | undefined> {
  const centralDirectory = await readBlobCentralDirectory(blob)
  return findEntryInCentralDirectory(centralDirectory.bytes, centralDirectory.totalEntries, selector)
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

async function extractIntoEntry(bytes: Uint8Array, entry: ZipEntry): Promise<void> {
  try {
    setEntryBytes(entry, await extractEntryBytes(bytes, entry))
  } catch (error) {
    entry.error = error instanceof Error ? error.message : 'Could not extract this file.'
  }
}

async function extractEntryBytes(bytes: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const view = toView(bytes)
  const offset = entry.localHeaderOffset

  if (view.getUint32(offset, true) !== localFileSignature) {
    throw new Error('Local file header is missing.')
  }

  const nameLength = view.getUint16(offset + 26, true)
  const extraLength = view.getUint16(offset + 28, true)
  const dataStart = offset + 30 + nameLength + extraLength
  const dataEnd = dataStart + entry.compressedSize
  const compressed = bytes.subarray(dataStart, dataEnd)

  if (entry.method === 0) {
    return copyUint8Array(compressed)
  }

  if (entry.method === 8) {
    return inflateRaw(compressed)
  }

  throw new Error(`Compression method ${entry.method} is not supported.`)
}

async function extractBlobIntoEntry(blob: Blob, entry: ZipEntry): Promise<void> {
  try {
    setEntryBytes(entry, await extractBlobEntryBytes(blob, entry))
  } catch (error) {
    entry.error = error instanceof Error ? error.message : 'Could not extract this file.'
  }
}

async function extractBlobEntryBytes(blob: Blob, entry: ZipEntry): Promise<Uint8Array> {
  const fixedHeader = await readBlobSlice(blob, entry.localHeaderOffset, entry.localHeaderOffset + 30)
  const fixedHeaderView = toView(fixedHeader)

  if (fixedHeaderView.getUint32(0, true) !== localFileSignature) {
    throw new Error('Local file header is missing.')
  }

  const nameLength = fixedHeaderView.getUint16(26, true)
  const extraLength = fixedHeaderView.getUint16(28, true)
  const dataStart = entry.localHeaderOffset + 30 + nameLength + extraLength
  const dataEnd = dataStart + entry.compressedSize
  const compressed = await readBlobSlice(blob, dataStart, dataEnd)

  if (entry.method === 0) {
    return copyUint8Array(compressed)
  }

  if (entry.method === 8) {
    return inflateRaw(compressed)
  }

  throw new Error(`Compression method ${entry.method} is not supported.`)
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

async function readBlobCentralDirectory(blob: Blob): Promise<{ bytes: Uint8Array; totalEntries: number }> {
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
  }
}

async function readBlobSlice(blob: Blob, start: number, end: number): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer())
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const browserInflated = await inflateRawWithCompressionStream(bytes)

  if (browserInflated) {
    return browserInflated
  }

  const backendInflated = await inflateRawWithNode(bytes)

  if (backendInflated) {
    return backendInflated
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
  const specifier = 'node:zlib'

  try {
    return (await import(specifier)) as NodeZlib
  } catch {
    return undefined
  }
}

function setEntryBytes(entry: ZipEntry, bytes: Uint8Array): void {
  entry.bytes = bytes

  if (hasBlobConstructor()) {
    entry.blob = new Blob([copyBytes(bytes)])
  }
}

function isBlob(source: ZipSource): source is Blob {
  return hasBlobConstructor() && source instanceof Blob
}

function hasBlobConstructor(): boolean {
  return typeof Blob !== 'undefined'
}

function findEndOfCentralDirectory(view: DataView): number {
  const minOffset = Math.max(0, view.byteLength - maxCommentLength - 22)

  for (let offset = view.byteLength - 22; offset >= minOffset; offset -= 1) {
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
