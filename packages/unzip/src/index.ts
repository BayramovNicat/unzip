export type ZipEntry = {
  name: string
  compressedSize: number
  uncompressedSize: number
  method: number
  localHeaderOffset: number
  isDirectory: boolean
  blob?: Blob
  error?: string
}

const decoder = new TextDecoder()
const maxCommentLength = 0xffff
const eocdSignature = 0x06054b50
const centralDirectorySignature = 0x02014b50
const localFileSignature = 0x04034b50

export async function unzip(bytes: Uint8Array): Promise<ZipEntry[]> {
  const view = toView(bytes)
  const eocdOffset = findEndOfCentralDirectory(view)
  const totalEntries = view.getUint16(eocdOffset + 10, true)
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true)
  const entries: ZipEntry[] = []
  let offset = centralDirectoryOffset

  for (let index = 0; index < totalEntries; index += 1) {
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
    const isDirectory = name.endsWith('/')

    const entry: ZipEntry = {
      name,
      compressedSize,
      uncompressedSize,
      method,
      localHeaderOffset,
      isDirectory,
    }

    if (!isDirectory) {
      try {
        entry.blob = await extractEntry(bytes, entry)
      } catch (error) {
        entry.error = error instanceof Error ? error.message : 'Could not extract this file.'
      }
    }

    entries.push(entry)
    offset = nameStart + nameLength + extraLength + commentLength
  }

  return entries
}

async function extractEntry(bytes: Uint8Array, entry: ZipEntry): Promise<Blob> {
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
    return new Blob([copyBytes(compressed)])
  }

  if (entry.method === 8) {
    return inflateRaw(compressed)
  }

  throw new Error(`Compression method ${entry.method} is not supported.`)
}

async function inflateRaw(bytes: Uint8Array): Promise<Blob> {
  if (!('DecompressionStream' in globalThis)) {
    throw new Error('This browser does not support native decompression.')
  }

  const stream = new Blob([copyBytes(bytes)]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Response(stream).blob()
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
