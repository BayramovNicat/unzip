import { performance } from 'node:perf_hooks'
import { deflateRawSync } from 'node:zlib'
import { extractZipEntry, findZipEntry, listZipEntries, unzip } from '@holmityd/unzip'

type ZipFixtureEntry = {
  name: string
  data: Uint8Array
  method: number
}

type Benchmark = {
  name: string
  iterations: number
  warmup: number
  run: () => void | Promise<void>
}

type BenchmarkResult = {
  name: string
  iterations: number
  totalMs: number
  meanMs: number
  opsPerSecond: number
}

const textEncoder = new TextEncoder()
const smallArchive = createZip(createEntries({ count: 100, size: 512, method: 0 }))
const mixedArchive = createZip(createEntries({ count: 250, size: 1024, method: 'mixed' }))
const largeArchive = createZip(createEntries({ count: 1000, size: 2048, method: 'mixed' }))

const benchmarks: Benchmark[] = [
  {
    name: 'list entries, 1k mixed files',
    iterations: 500,
    warmup: 50,
    run: () => {
      listZipEntries(largeArchive)
    },
  },
  {
    name: 'find first entry, 1k mixed files',
    iterations: 1000,
    warmup: 100,
    run: () => {
      findZipEntry(largeArchive, 'file-0000.txt')
    },
  },
  {
    name: 'find last entry, 1k mixed files',
    iterations: 500,
    warmup: 50,
    run: () => {
      findZipEntry(largeArchive, 'file-0999.txt')
    },
  },
  {
    name: 'extract one stored entry, 100 files',
    iterations: 500,
    warmup: 50,
    run: async () => {
      await extractZipEntry(smallArchive, 'file-0099.txt')
    },
  },
  {
    name: 'extract three mixed entries, 250 files',
    iterations: 200,
    warmup: 25,
    run: async () => {
      await extractZipEntry(mixedArchive, ['file-0001.txt', 'file-0125.txt', 'file-0249.txt'])
    },
  },
  {
    name: 'unzip all, 250 mixed files',
    iterations: 25,
    warmup: 5,
    run: async () => {
      await unzip(mixedArchive)
    },
  },
]

const results: BenchmarkResult[] = []

for (const benchmark of benchmarks) {
  results.push(await runBenchmark(benchmark))
}

printResults(results)

async function runBenchmark(benchmark: Benchmark): Promise<BenchmarkResult> {
  for (let index = 0; index < benchmark.warmup; index += 1) {
    await benchmark.run()
  }

  const startedAt = performance.now()

  for (let index = 0; index < benchmark.iterations; index += 1) {
    await benchmark.run()
  }

  const totalMs = performance.now() - startedAt
  const meanMs = totalMs / benchmark.iterations

  return {
    name: benchmark.name,
    iterations: benchmark.iterations,
    totalMs,
    meanMs,
    opsPerSecond: 1000 / meanMs,
  }
}

function printResults(results: BenchmarkResult[]): void {
  const nameWidth = Math.max(...results.map((result) => result.name.length), 'benchmark'.length)
  const rows = [
    `${pad('benchmark', nameWidth)}  iterations  mean ms  ops/sec`,
    `${'-'.repeat(nameWidth)}  ----------  -------  -------`,
    ...results.map((result) =>
      [
        pad(result.name, nameWidth),
        padLeft(result.iterations.toString(), 10),
        padLeft(result.meanMs.toFixed(3), 7),
        padLeft(result.opsPerSecond.toFixed(0), 7),
      ].join('  '),
    ),
  ]

  console.log(rows.join('\n'))
}

function createEntries(options: {
  count: number
  size: number
  method: 0 | 8 | 'mixed'
}): ZipFixtureEntry[] {
  return Array.from({ length: options.count }, (_, index) => {
    const method = options.method === 'mixed' ? (index % 2 === 0 ? 0 : 8) : options.method

    return {
      name: `file-${index.toString().padStart(4, '0')}.txt`,
      data: createData(index, options.size),
      method,
    }
  })
}

function createData(seed: number, size: number): Uint8Array {
  const prefix = textEncoder.encode(`entry:${seed}:`)
  const data = new Uint8Array(size)

  for (let index = 0; index < data.byteLength; index += 1) {
    data[index] = prefix[index % prefix.byteLength] ?? 0
  }

  return data
}

function createZip(entries: ZipFixtureEntry[]): Uint8Array {
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let localOffset = 0

  for (const entry of entries) {
    const name = textEncoder.encode(entry.name)
    const compressed = entry.method === 8 ? new Uint8Array(deflateRawSync(entry.data)) : entry.data
    const localHeader = localFileHeader({
      name,
      method: entry.method,
      compressedSize: compressed.byteLength,
      uncompressedSize: entry.data.byteLength,
    })
    const centralHeader = centralDirectoryHeader({
      name,
      method: entry.method,
      compressedSize: compressed.byteLength,
      uncompressedSize: entry.data.byteLength,
      localOffset,
    })

    localParts.push(localHeader, compressed)
    centralParts.push(centralHeader)
    localOffset += localHeader.byteLength + compressed.byteLength
  }

  const centralOffset = localOffset
  const centralDirectory = concat(centralParts)
  const eocd = endOfCentralDirectory({
    entryCount: entries.length,
    centralOffset,
    centralSize: centralDirectory.byteLength,
  })

  return concat([...localParts, centralDirectory, eocd])
}

function localFileHeader(options: {
  name: Uint8Array
  method: number
  compressedSize: number
  uncompressedSize: number
}): Uint8Array {
  const header = new Uint8Array(30 + options.name.byteLength)
  const view = new DataView(header.buffer)

  view.setUint32(0, 0x04034b50, true)
  view.setUint16(4, 20, true)
  view.setUint16(6, 0x0800, true)
  view.setUint16(8, options.method, true)
  view.setUint32(14, 0, true)
  view.setUint32(18, options.compressedSize, true)
  view.setUint32(22, options.uncompressedSize, true)
  view.setUint16(26, options.name.byteLength, true)
  header.set(options.name, 30)

  return header
}

function centralDirectoryHeader(options: {
  name: Uint8Array
  method: number
  compressedSize: number
  uncompressedSize: number
  localOffset: number
}): Uint8Array {
  const header = new Uint8Array(46 + options.name.byteLength)
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
  view.setUint32(42, options.localOffset, true)
  header.set(options.name, 46)

  return header
}

function endOfCentralDirectory(options: {
  entryCount: number
  centralOffset: number
  centralSize: number
}): Uint8Array {
  const header = new Uint8Array(22)
  const view = new DataView(header.buffer)

  view.setUint32(0, 0x06054b50, true)
  view.setUint16(8, options.entryCount, true)
  view.setUint16(10, options.entryCount, true)
  view.setUint32(12, options.centralSize, true)
  view.setUint32(16, options.centralOffset, true)

  return header
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

function pad(value: string, length: number): string {
  return value.padEnd(length, ' ')
}

function padLeft(value: string, length: number): string {
  return value.padStart(length, ' ')
}
