import { endOfCentralDirectoryLength, eocdSignature, maxCommentLength } from './constants.js'

export function findEndOfCentralDirectory(view: DataView): number {
  const minOffset = Math.max(0, view.byteLength - maxCommentLength - endOfCentralDirectoryLength)

  for (let offset = view.byteLength - endOfCentralDirectoryLength; offset >= minOffset; offset -= 1) {
    if (view.getUint32(offset, true) === eocdSignature) {
      return offset
    }
  }

  throw new Error('This does not look like a ZIP file.')
}

export function toView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

export function copyBytes(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

export function copyUint8Array(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(copyBytes(bytes))
}
