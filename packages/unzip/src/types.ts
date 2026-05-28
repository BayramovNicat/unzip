/**
 * Metadata and optional extracted data for one ZIP archive entry.
 *
 * Extracted file entries always receive `bytes`. Browser extractions also
 * receive `blob`. Directory entries and failed file extractions do not receive
 * file data.
 */
export type ZipEntry = {
  /** Path stored in the ZIP archive. */
  name: string
  /** Compressed byte length from the central directory. */
  compressedSize: number
  /** Uncompressed byte length from the central directory. */
  uncompressedSize: number
  /** ZIP compression method. Methods `0` stored and `8` deflated are supported. */
  method: number
  /** Byte offset of the entry's local file header in the archive. */
  localHeaderOffset: number
  /** Whether this entry is a directory, based on a trailing `/` in `name`. */
  isDirectory: boolean
  /** Extracted file bytes, present after successful extraction. */
  bytes?: Uint8Array
  /** Extracted file data as a browser `Blob`, present only in browser-like runtimes. */
  blob?: Blob
  /** Per-entry extraction error, present when metadata was read but extraction failed. */
  error?: string
}

/**
 * Selects a ZIP entry by exact name, regular expression, or predicate.
 *
 * Regular expression selectors are tested against `ZipEntry.name`. Predicate
 * selectors receive entry metadata before extraction.
 */
export type ZipEntrySelector = string | RegExp | ((entry: ZipEntry) => boolean)

/** ZIP input accepted by extraction APIs. */
export type ZipSource = Uint8Array | Blob

export type ZipEntrySelection = ZipEntrySelector | readonly ZipEntrySelector[]

export type CentralDirectory = {
  bytes: Uint8Array
  totalEntries: number
  offset: number
}

export type ReadSlice = (start: number, end: number) => Uint8Array | Promise<Uint8Array>

export type NodeZlib = {
  inflateRaw(input: Uint8Array, callback: (error: Error | null, data: Uint8Array) => void): void
}
