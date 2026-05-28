import { copyBytes, findEndOfCentralDirectory, toView } from './bytes.js'
import { endOfCentralDirectoryLength, maxCommentLength } from './constants.js'
import type { CentralDirectory } from './types.js'

export class BytesSourceReader {
  private readonly bytes: Uint8Array

  constructor(bytes: Uint8Array) {
    this.bytes = bytes
  }

  read(start: number, end: number): Uint8Array {
    return this.bytes.subarray(start, end)
  }

  readCentralDirectory(): CentralDirectory {
    const view = toView(this.bytes)
    const eocdOffset = findEndOfCentralDirectory(view)

    return {
      bytes: this.bytes,
      totalEntries: view.getUint16(eocdOffset + 10, true),
      offset: view.getUint32(eocdOffset + 16, true),
    }
  }

  createBlob(bytes: Uint8Array): Blob | undefined {
    return createBrowserBlob(bytes)
  }
}

export class BlobSourceReader {
  private readonly blob: Blob

  constructor(blob: Blob) {
    this.blob = blob
  }

  async read(start: number, end: number): Promise<Uint8Array> {
    return new Uint8Array(await this.blob.slice(start, end).arrayBuffer())
  }

  async readCentralDirectory(): Promise<CentralDirectory> {
    const tailLength = Math.min(this.blob.size, maxCommentLength + endOfCentralDirectoryLength)
    const tailStart = this.blob.size - tailLength
    const tail = await this.read(tailStart, this.blob.size)
    const tailView = toView(tail)
    const eocdOffset = findEndOfCentralDirectory(tailView)
    const totalEntries = tailView.getUint16(eocdOffset + 10, true)
    const centralDirectorySize = tailView.getUint32(eocdOffset + 12, true)
    const centralDirectoryOffset = tailView.getUint32(eocdOffset + 16, true)

    return {
      bytes: await this.read(centralDirectoryOffset, centralDirectoryOffset + centralDirectorySize),
      totalEntries,
      offset: 0,
    }
  }

  createBlob(bytes: Uint8Array): Blob | undefined {
    return createBrowserBlob(bytes)
  }
}

function createBrowserBlob(bytes: Uint8Array): Blob | undefined {
  return canCreateEntryBlob() ? new Blob([copyBytes(bytes)]) : undefined
}

function canCreateEntryBlob(): boolean {
  return typeof Blob !== 'undefined' && typeof window !== 'undefined'
}
