# @holmityd/unzip

A tiny TypeScript ZIP reader for browsers and backend runtimes.

It can list files, find one file, or extract ZIP entries. File data is returned on each extracted entry as `bytes`, and also as `blob` when the runtime supports `Blob`.

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

Successful file entries include `entry.bytes`. They also include `entry.blob` when `Blob` exists. If one file cannot be extracted, that entry is still returned with `entry.error`.

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
```

Finds and extracts the first matching entry.

`source` can be `Uint8Array` or `Blob`. Returns `undefined` when no entry matches. Directory entries are returned without file data.

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

Selectors match one entry:

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
