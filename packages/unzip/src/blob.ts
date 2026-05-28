import { copyBytes } from './bytes'
import type { ZipSource } from './types'

export function isBlob(source: ZipSource): source is Blob {
  return hasBlobConstructor() && source instanceof Blob
}

export function hasBlobConstructor(): boolean {
  return typeof Blob !== 'undefined'
}

export function canCreateEntryBlob(): boolean {
  return hasBlobConstructor() && typeof window !== 'undefined'
}

export function createEntryBlob(bytes: Uint8Array): Blob {
  return new Blob([copyBytes(bytes)])
}

export async function readBlobSlice(blob: Blob, start: number, end: number): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer())
}
