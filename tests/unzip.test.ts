import { describe, expect, test } from 'bun:test'
import {
  extractZipEntry,
  findZipEntry,
  listZipEntries,
  unzip,
  type ZipEntry,
} from '@holmityd/unzip'

type ZipFixtureEntry = {
  name: string
  data?: string | Uint8Array
  method?: number
  extra?: Uint8Array
  comment?: string
}

type NodeZlib = {
  deflateRawSync(input: Uint8Array): Uint8Array
}

const textEncoder = new TextEncoder()
const { deflateRawSync } = await loadNodeZlib()

describe('unzip', () => {
  test('rejects input that is not a ZIP archive', async () => {
    await expect(unzip(textEncoder.encode('not a zip'))).rejects.toThrow('This does not look like a ZIP file.')
  })

  test('reads an empty ZIP archive', async () => {
    await expect(unzip(createZip([]))).resolves.toEqual([])
  })

  test('extracts a stored text file', async () => {
    const [entry] = await unzip(createZip([{ name: 'hello.txt', data: 'hello world' }]))

    expect(entry?.name).toBe('hello.txt')
    expect(entry?.isDirectory).toBe(false)
    expect(entry?.compressedSize).toBe(11)
    expect(entry?.uncompressedSize).toBe(11)
    expect(entry?.error).toBeUndefined()
    await expect(entryText(entry)).resolves.toBe('hello world')
  })

  test('extracts a deflated text file', async () => {
    const [entry] = await unzip(createZip([{ name: 'deflated.txt', data: 'repeat repeat repeat repeat', method: 8 }]))

    expect(entry?.method).toBe(8)
    expect(entry?.compressedSize).toBeLessThan(entry?.uncompressedSize ?? 0)
    expect(entry?.error).toBeUndefined()
    await expect(entryText(entry)).resolves.toBe('repeat repeat repeat repeat')
  })

  test('extracts binary bytes without text conversion', async () => {
    const bytes = new Uint8Array([0, 1, 2, 3, 254, 255])
    const [entry] = await unzip(createZip([{ name: 'image.bin', data: bytes }]))

    expect(entry?.bytes).toEqual(bytes)
    await expect(entryBytes(entry)).resolves.toEqual(bytes)
  })

  test('extracts zero-byte files', async () => {
    const [entry] = await unzip(createZip([{ name: 'empty.txt', data: '' }]))

    expect(entry?.compressedSize).toBe(0)
    expect(entry?.uncompressedSize).toBe(0)
    await expect(entryText(entry)).resolves.toBe('')
  })

  test('keeps directories as entries without creating blobs', async () => {
    const entries = await unzip(createZip([{ name: 'folder/' }, { name: 'folder/file.txt', data: 'nested' }]))

    expect(entries.map((entry) => entry.name)).toEqual(['folder/', 'folder/file.txt'])
    expect(entries[0]?.isDirectory).toBe(true)
    expect(entries[0]?.blob).toBeUndefined()
    await expect(entryText(entries[1])).resolves.toBe('nested')
  })

  test('preserves archive order for multiple files', async () => {
    const entries = await unzip(
      createZip([
        { name: 'a.txt', data: 'a' },
        { name: 'b.txt', data: 'b', method: 8 },
        { name: 'c.txt', data: 'c' },
      ]),
    )

    expect(entries.map((entry) => entry.name)).toEqual(['a.txt', 'b.txt', 'c.txt'])
    await expect(Promise.all(entries.map(entryText))).resolves.toEqual(['a', 'b', 'c'])
  })

  test('handles unicode filenames', async () => {
    const [entry] = await unzip(createZip([{ name: 'notes/çay.txt', data: 'Baku' }]))

    expect(entry?.name).toBe('notes/çay.txt')
    await expect(entryText(entry)).resolves.toBe('Baku')
  })

  test('handles local and central extra fields', async () => {
    const [entry] = await unzip(
      createZip([{ name: 'extra.txt', data: 'extra data', extra: new Uint8Array([1, 2, 3, 4]) }]),
    )

    expect(entry?.name).toBe('extra.txt')
    await expect(entryText(entry)).resolves.toBe('extra data')
  })

  test('finds ZIP archives with comments', async () => {
    const [entry] = await unzip(createZip([{ name: 'commented.txt', data: 'ok' }], 'archive comment'))

    expect(entry?.name).toBe('commented.txt')
    await expect(entryText(entry)).resolves.toBe('ok')
  })

  test('supports Uint8Array views with non-zero byte offsets', async () => {
    const archive = createZip([{ name: 'view.txt', data: 'offset-safe' }])
    const padded = new Uint8Array(archive.byteLength + 8)
    padded.set(archive, 4)
    const view = padded.subarray(4, 4 + archive.byteLength)
    const [entry] = await unzip(view)

    await expect(entryText(entry)).resolves.toBe('offset-safe')
  })

  test('reports unsupported compression methods per file', async () => {
    const [entry] = await unzip(createZip([{ name: 'legacy.bin', data: 'unsupported', method: 12 }]))

    expect(entry?.name).toBe('legacy.bin')
    expect(entry?.blob).toBeUndefined()
    expect(entry?.error).toBe('Compression method 12 is not supported.')
  })

  test('reports missing local file headers per file', async () => {
    const archive = createZip([{ name: 'broken.txt', data: 'broken' }])
    archive[0] = 0
    const [entry] = await unzip(archive)

    expect(entry?.name).toBe('broken.txt')
    expect(entry?.blob).toBeUndefined()
    expect(entry?.error).toBe('Local file header is missing.')
  })

  test('rejects malformed central directories', async () => {
    const archive = createZip([{ name: 'broken-central.txt', data: 'broken' }])
    const centralOffset = findSignature(archive, 0x02014b50)
    archive[centralOffset] = 0

    await expect(unzip(archive)).rejects.toThrow('The ZIP central directory is malformed.')
  })

  test('lists entries without extracting file data', () => {
    const entries = listZipEntries(createZip([{ name: 'meta.txt', data: 'metadata only', method: 8 }]))

    expect(entries).toHaveLength(1)
    expect(entries[0]?.name).toBe('meta.txt')
    expect(entries[0]?.blob).toBeUndefined()
    expect(entries[0]?.error).toBeUndefined()
  })

  test('finds one entry by exact name without extracting it', () => {
    const entry = findZipEntry(
      createZip([
        { name: 'first.txt', data: 'first' },
        { name: 'target.txt', data: 'target', method: 8 },
      ]),
      'target.txt',
    )

    expect(entry?.name).toBe('target.txt')
    expect(entry?.blob).toBeUndefined()
  })

  test('extracts only the selected entry by name', async () => {
    const entry = await extractZipEntry(
      createZip([
        { name: 'legacy.bin', data: 'unsupported', method: 12 },
        { name: 'target.txt', data: 'target content', method: 8 },
      ]),
      'target.txt',
    )

    expect(entry?.name).toBe('target.txt')
    expect(entry?.error).toBeUndefined()
    await expect(entryText(entry)).resolves.toBe('target content')
  })

  test('extracts one entry by regex selector', async () => {
    const entry = await extractZipEntry(
      createZip([
        { name: 'a.txt', data: 'a' },
        { name: 'nested/report.json', data: '{"ok":true}', method: 8 },
      ]),
      /report\.json$/,
    )

    await expect(entryText(entry)).resolves.toBe('{"ok":true}')
  })

  test('extracts one entry as bytes for backend consumers', async () => {
    const entry = await extractZipEntry(
      createZip([{ name: 'server/report.txt', data: 'backend bytes', method: 8 }]),
      'server/report.txt',
    )

    expect(entry?.bytes).toEqual(textEncoder.encode('backend bytes'))
  })

  test('extracts selected entries from an array of selectors', async () => {
    const entries = await extractZipEntry(
      createZip([
        { name: 'a.txt', data: 'a' },
        { name: 'b.txt', data: 'b', method: 8 },
        { name: 'nested/c.txt', data: 'c' },
      ]),
      ['a.txt', /c\.txt$/],
    )

    expect(entries.map((entry) => entry.name)).toEqual(['a.txt', 'nested/c.txt'])
    await expect(Promise.all(entries.map(entryText))).resolves.toEqual(['a', 'c'])
  })

  test('returns an empty list for an empty selector array', async () => {
    const entries = await extractZipEntry(createZip([{ name: 'a.txt', data: 'a' }]), [])

    expect(entries).toEqual([])
  })

  test('skips missing selectors when extracting from an array', async () => {
    const entries = await extractZipEntry(
      createZip([
        { name: 'a.txt', data: 'a' },
        { name: 'b.txt', data: 'b' },
      ]),
      ['missing.txt', 'b.txt'],
    )

    expect(entries.map((entry) => entry.name)).toEqual(['b.txt'])
    await expect(Promise.all(entries.map(entryText))).resolves.toEqual(['b'])
  })

  test('does not duplicate entries when multiple selectors match the same file', async () => {
    const entries = await extractZipEntry(
      createZip([
        { name: 'a.txt', data: 'a' },
        { name: 'b.txt', data: 'b' },
      ]),
      ['a.txt', /\.txt$/],
    )

    expect(entries.map((entry) => entry.name)).toEqual(['a.txt', 'b.txt'])
  })

  test('supports predicate selectors in readonly selector arrays', async () => {
    const selectors = ['alpha.txt', (entry: ZipEntry) => entry.name === 'gamma.txt'] as const
    const entries = await extractZipEntry(
      createZip([
        { name: 'alpha.txt', data: 'alpha' },
        { name: 'beta.txt', data: 'beta' },
        { name: 'gamma.txt', data: 'gamma' },
      ]),
      selectors,
    )

    expect(entries.map((entry) => entry.name)).toEqual(['alpha.txt', 'gamma.txt'])
    await expect(Promise.all(entries.map(entryText))).resolves.toEqual(['alpha', 'gamma'])
  })

  test('returns selected directories without extracted data', async () => {
    const entries = await extractZipEntry(
      createZip([
        { name: 'folder/' },
        { name: 'folder/file.txt', data: 'file' },
      ]),
      ['folder/', 'folder/file.txt'],
    )

    expect(entries.map((entry) => entry.name)).toEqual(['folder/', 'folder/file.txt'])
    expect(entries[0]?.isDirectory).toBe(true)
    expect(entries[0]?.bytes).toBeUndefined()
    expect(entries[0]?.blob).toBeUndefined()
    await expect(entryText(entries[1])).resolves.toBe('file')
  })

  test('reports unsupported compression for selected entries in an array', async () => {
    const entries = await extractZipEntry(
      createZip([
        { name: 'legacy.bin', data: 'legacy', method: 12 },
        { name: 'ok.txt', data: 'ok' },
      ]),
      ['legacy.bin', 'ok.txt'],
    )

    expect(entries.map((entry) => entry.name)).toEqual(['legacy.bin', 'ok.txt'])
    expect(entries[0]?.bytes).toBeUndefined()
    expect(entries[0]?.blob).toBeUndefined()
    expect(entries[0]?.error).toBe('Compression method 12 is not supported.')
    await expect(entryText(entries[1])).resolves.toBe('ok')
  })

  test('extracts one entry by predicate selector', async () => {
    const entry = await extractZipEntry(
      createZip([
        { name: 'small.txt', data: 'tiny' },
        { name: 'large.txt', data: 'large text content', method: 8 },
      ]),
      (candidate) => candidate.uncompressedSize > 10,
    )

    expect(entry?.name).toBe('large.txt')
    await expect(entryText(entry)).resolves.toBe('large text content')
  })

  test('returns undefined when a selected entry is missing', async () => {
    const archive = createZip([{ name: 'exists.txt', data: 'exists' }])

    expect(findZipEntry(archive, 'missing.txt')).toBeUndefined()
    await expect(extractZipEntry(archive, 'missing.txt')).resolves.toBeUndefined()
  })

  test('extracts one Blob entry without reading the whole archive', async () => {
    const archive = createZip([
      { name: 'big-skipped.bin', data: new Uint8Array(100_000), method: 12 },
      { name: 'target.txt', data: 'target from blob', method: 8 },
      { name: 'ignored.txt', data: 'ignored' },
    ])
    const blob = new TrackingBlob([copyBytes(archive)])
    const entry = await extractZipEntry(blob, 'target.txt')

    expect(entry?.name).toBe('target.txt')
    expect(entry?.error).toBeUndefined()
    await expect(entryText(entry)).resolves.toBe('target from blob')
    expect(blob.slices.length).toBe(4)
    expect(blob.slices.every((slice) => slice.start !== 0 || slice.end !== archive.byteLength)).toBe(true)
  })

  test('extracts selected Blob entries from an array of selectors', async () => {
    const archive = createZip([
      { name: 'one.txt', data: 'one' },
      { name: 'two.txt', data: 'two', method: 8 },
      { name: 'three.txt', data: 'three' },
    ])
    const blob = new Blob([copyBytes(archive)])
    const entries = await extractZipEntry(blob, ['one.txt', 'three.txt'])

    expect(entries.map((entry) => entry.name)).toEqual(['one.txt', 'three.txt'])
    await expect(Promise.all(entries.map(entryText))).resolves.toEqual(['one', 'three'])
  })

  test('handles empty and missing selector arrays for Blob entries', async () => {
    const archive = createZip([{ name: 'exists.txt', data: 'exists' }])
    const blob = new Blob([copyBytes(archive)])

    await expect(extractZipEntry(blob, [])).resolves.toEqual([])
    await expect(extractZipEntry(blob, ['missing.txt'])).resolves.toEqual([])
  })

  test('returns selected Blob directories and extraction errors in arrays', async () => {
    const archive = createZip([
      { name: 'folder/' },
      { name: 'legacy.bin', data: 'legacy', method: 12 },
      { name: 'folder/file.txt', data: 'file' },
    ])
    const blob = new Blob([copyBytes(archive)])
    const entries = await extractZipEntry(blob, ['folder/', 'legacy.bin', 'folder/file.txt'])

    expect(entries.map((entry) => entry.name)).toEqual(['folder/', 'legacy.bin', 'folder/file.txt'])
    expect(entries[0]?.bytes).toBeUndefined()
    expect(entries[0]?.blob).toBeUndefined()
    expect(entries[1]?.error).toBe('Compression method 12 is not supported.')
    await expect(entryText(entries[2])).resolves.toBe('file')
  })
})

async function entryText(entry: ZipEntry | undefined): Promise<string> {
  if (!entry?.bytes) {
    throw new Error('Expected entry to have bytes.')
  }

  return new TextDecoder().decode(entry.bytes)
}

async function entryBytes(entry: ZipEntry | undefined): Promise<Uint8Array> {
  if (!entry?.bytes) {
    throw new Error('Expected entry to have bytes.')
  }

  return entry.bytes
}

function createZip(entries: ZipFixtureEntry[], comment = ''): Uint8Array {
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let localOffset = 0

  for (const entry of entries) {
    const name = textEncoder.encode(entry.name)
    const data = toBytes(entry.data ?? '')
    const method = entry.name.endsWith('/') ? 0 : (entry.method ?? 0)
    const compressed = method === 8 ? new Uint8Array(deflateRawSync(data)) : data
    const extra = entry.extra ?? new Uint8Array()
    const fileComment = textEncoder.encode(entry.comment ?? '')

    const localHeader = localFileHeader({
      name,
      extra,
      method,
      compressedSize: compressed.byteLength,
      uncompressedSize: data.byteLength,
    })
    const centralHeader = centralDirectoryHeader({
      name,
      extra,
      comment: fileComment,
      method,
      compressedSize: compressed.byteLength,
      uncompressedSize: data.byteLength,
      localOffset,
    })

    localParts.push(localHeader, compressed)
    centralParts.push(centralHeader)
    localOffset += localHeader.byteLength + compressed.byteLength
  }

  const centralOffset = localOffset
  const centralDirectory = concat(centralParts)
  const encodedComment = textEncoder.encode(comment)
  const eocd = endOfCentralDirectory({
    entryCount: entries.length,
    centralOffset,
    centralSize: centralDirectory.byteLength,
    comment: encodedComment,
  })

  return concat([...localParts, centralDirectory, eocd])
}

function localFileHeader(options: {
  name: Uint8Array
  extra: Uint8Array
  method: number
  compressedSize: number
  uncompressedSize: number
}): Uint8Array {
  const header = new Uint8Array(30 + options.name.byteLength + options.extra.byteLength)
  const view = new DataView(header.buffer)

  view.setUint32(0, 0x04034b50, true)
  view.setUint16(4, 20, true)
  view.setUint16(6, 0x0800, true)
  view.setUint16(8, options.method, true)
  view.setUint32(14, 0, true)
  view.setUint32(18, options.compressedSize, true)
  view.setUint32(22, options.uncompressedSize, true)
  view.setUint16(26, options.name.byteLength, true)
  view.setUint16(28, options.extra.byteLength, true)
  header.set(options.name, 30)
  header.set(options.extra, 30 + options.name.byteLength)

  return header
}

function centralDirectoryHeader(options: {
  name: Uint8Array
  extra: Uint8Array
  comment: Uint8Array
  method: number
  compressedSize: number
  uncompressedSize: number
  localOffset: number
}): Uint8Array {
  const header = new Uint8Array(
    46 + options.name.byteLength + options.extra.byteLength + options.comment.byteLength,
  )
  const view = new DataView(header.buffer)

  view.setUint32(0, 0x02014b50, true)
  view.setUint16(4, 20, true)
  view.setUint16(6, 20, true)
  view.setUint16(8, 0x0800, true)
  view.setUint16(10, options.method, true)
  view.setUint32(16, 0, true)
  view.setUint32(20, options.compressedSize, true)
  view.setUint32(24, options.uncompressedSize, true)
  view.setUint16(28, options.name.byteLength, true)
  view.setUint16(30, options.extra.byteLength, true)
  view.setUint16(32, options.comment.byteLength, true)
  view.setUint32(42, options.localOffset, true)
  header.set(options.name, 46)
  header.set(options.extra, 46 + options.name.byteLength)
  header.set(options.comment, 46 + options.name.byteLength + options.extra.byteLength)

  return header
}

function endOfCentralDirectory(options: {
  entryCount: number
  centralOffset: number
  centralSize: number
  comment: Uint8Array
}): Uint8Array {
  const header = new Uint8Array(22 + options.comment.byteLength)
  const view = new DataView(header.buffer)

  view.setUint32(0, 0x06054b50, true)
  view.setUint16(8, options.entryCount, true)
  view.setUint16(10, options.entryCount, true)
  view.setUint32(12, options.centralSize, true)
  view.setUint32(16, options.centralOffset, true)
  view.setUint16(20, options.comment.byteLength, true)
  header.set(options.comment, 22)

  return header
}

function toBytes(data: string | Uint8Array): Uint8Array {
  return typeof data === 'string' ? textEncoder.encode(data) : data
}

function copyBytes(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function concat(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.byteLength, 0)
  const output = new Uint8Array(length)
  let offset = 0

  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }

  return output
}

function findSignature(bytes: Uint8Array, signature: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  for (let offset = 0; offset <= bytes.byteLength - 4; offset += 1) {
    if (view.getUint32(offset, true) === signature) {
      return offset
    }
  }

  throw new Error(`Signature ${signature.toString(16)} not found.`)
}

class TrackingBlob extends Blob {
  slices: Array<{ start: number; end: number }> = []

  override slice(start?: number, end?: number, contentType?: string): Blob {
    this.slices.push({
      start: start ?? 0,
      end: end ?? this.size,
    })

    return super.slice(start, end, contentType)
  }
}

async function loadNodeZlib(): Promise<NodeZlib> {
  const specifier = 'node:zlib'
  return (await import(/* @vite-ignore */ specifier)) as NodeZlib
}
