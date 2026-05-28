import { isBlob, readBlobSlice } from './blob'
import { endOfCentralDirectoryLength, maxCommentLength } from './constants'
import { readCentralDirectory, readEndOfCentralDirectory } from './central-directory'
import type { CentralDirectory, ReadSlice, ZipSource } from './types'

export function readSourceCentralDirectory(source: ZipSource): CentralDirectory | Promise<CentralDirectory> {
  return isBlob(source) ? readBlobCentralDirectory(source) : readCentralDirectory(source)
}

export function readSourceSlice(source: ZipSource): ReadSlice {
  return isBlob(source) ? (start, end) => readBlobSlice(source, start, end) : (start, end) => source.subarray(start, end)
}

async function readBlobCentralDirectory(blob: Blob): Promise<CentralDirectory> {
  const tailLength = Math.min(blob.size, maxCommentLength + endOfCentralDirectoryLength)
  const tailStart = blob.size - tailLength
  const tail = await readBlobSlice(blob, tailStart, blob.size)
  const { totalEntries, centralDirectorySize, centralDirectoryOffset } = readEndOfCentralDirectory(tail)

  return {
    bytes: await readBlobSlice(blob, centralDirectoryOffset, centralDirectoryOffset + centralDirectorySize),
    totalEntries,
    offset: 0,
  }
}
