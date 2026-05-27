# @holmityd/unzip

A tiny TypeScript ZIP reader for browsers and backend runtimes.

It can list files, find one file, or extract ZIP entries. File data is returned on each extracted entry as `bytes`, and also as `blob` in browsers.

Browser test app: https://unzip-fawn.vercel.app/

```sh
npm install @holmityd/unzip
```

```ts
import { extractZipEntry, findZipEntry, listZipEntries, unzip } from '@holmityd/unzip'
```

## Quick Use

Extract every file from a ZIP:

```ts
const entries = await unzip(zipBytes)

for (const entry of entries) {
  if (entry.error) {
    console.warn(entry.name, entry.error)
  } else if (entry.bytes) {
    console.log(entry.name, entry.bytes)
  }
}
```

Extract one file:

```ts
const entry = await extractZipEntry(zipBytes, 'docs/readme.txt')

if (entry?.bytes) {
  console.log(new TextDecoder().decode(entry.bytes))
}
```

Extract a few files:

```ts
const entries = await extractZipEntry(zipBytes, ['a.txt', 'b.txt', /docs\/.+\.md$/])

for (const entry of entries) {
  console.log(entry.name, entry.bytes)
}
```

Use a browser `File` or any `Blob`:

```ts
const entry = await extractZipEntry(file, 'image.png')
const url = entry?.blob ? URL.createObjectURL(entry.blob) : undefined
```

## API

### `unzip(bytes)`

```ts
function unzip(bytes: Uint8Array): Promise<ZipEntry[]>
```

Lists and extracts every non-directory entry from ZIP bytes.

Successful file entries include `entry.bytes`. They also include `entry.blob` in browsers. If one file cannot be extracted, that entry is still returned with `entry.error`.

### `listZipEntries(bytes)`

```ts
function listZipEntries(bytes: Uint8Array): ZipEntry[]
```

Lists ZIP entries without extracting file data.

Use this when you only need names, sizes, methods, or directory information.

### `findZipEntry(bytes, selector)`

```ts
function findZipEntry(bytes: Uint8Array, selector: ZipEntrySelector): ZipEntry | undefined
```

Finds the first matching entry without extracting file data.

```ts
const entry = findZipEntry(zipBytes, /package\.json$/)
```

### `extractZipEntry(source, selector)`

```ts
function extractZipEntry(source: ZipSource, selector: ZipEntrySelector): Promise<ZipEntry | undefined>
function extractZipEntry(source: ZipSource, selector: readonly ZipEntrySelector[]): Promise<ZipEntry[]>
```

Finds and extracts matching entries.

`source` can be `Uint8Array` or `Blob`.

Pass one selector to extract the first matching entry. It returns `undefined` when no entry matches.

Pass an array of selectors to extract every entry that matches any selector. It returns entries in archive order. Missing matches are skipped.

Directory entries are returned without file data.

## Types

### `ZipEntry`

```ts
type ZipEntry = {
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
```

### `ZipEntrySelector`

```ts
type ZipEntrySelector = string | RegExp | ((entry: ZipEntry) => boolean)
```

Selectors match entries:

- `string`: exact `entry.name`
- `RegExp`: tested against `entry.name`
- function: return `true` for the entry you want

### `ZipSource`

```ts
type ZipSource = Uint8Array | Blob
```

## Notes

- Supports stored entries, method `0`.
- Supports deflated entries, method `8`.
- Uses `DecompressionStream` in browsers when available.
- Uses `node:zlib` as a backend fallback.
- ZIP64 and encrypted ZIP files are not supported.

## Benchmarks

```sh
bun run bench
```

The benchmark script measures listing, finding first and last entries, extracting one entry, extracting a few selected entries, and unzipping all entries from generated ZIP archives.

## Vercel Deploy

This repository includes a `vercel.json` for the example app:

- Install command: `bun install --frozen-lockfile`
- Build command: `bun run build`
- Output directory: `dist`

## Publishing

```sh
bun run --cwd packages/unzip build
cd packages/unzip
npm pack --dry-run
npm publish
```
