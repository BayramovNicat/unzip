import { copyBytes, copyUint8Array } from './bytes'
import { hasBlobConstructor } from './blob'

type NodeZlib = {
  inflateRaw(input: Uint8Array, callback: (error: Error | null, data: Uint8Array) => void): void
}

let nodeZlibPromise: Promise<NodeZlib | undefined> | undefined

export async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const backendInflated = await inflateRawWithNode(bytes)

  if (backendInflated) {
    return backendInflated
  }

  const browserInflated = await inflateRawWithCompressionStream(bytes)

  if (browserInflated) {
    return browserInflated
  }

  throw new Error('This runtime does not support native decompression.')
}

async function inflateRawWithCompressionStream(bytes: Uint8Array): Promise<Uint8Array | undefined> {
  if (
    !hasBlobConstructor() ||
    !('DecompressionStream' in globalThis) ||
    !('Response' in globalThis)
  ) {
    return undefined
  }

  try {
    const stream = new Blob([copyBytes(bytes)]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  } catch {
    return undefined
  }
}

async function inflateRawWithNode(bytes: Uint8Array): Promise<Uint8Array | undefined> {
  const zlib = await loadNodeZlib()

  if (!zlib) {
    return undefined
  }

  return new Promise<Uint8Array>((resolve, reject) => {
    zlib.inflateRaw(copyUint8Array(bytes), (error, data) => {
      if (error) {
        reject(error)
        return
      }

      resolve(copyUint8Array(data))
    })
  })
}

async function loadNodeZlib(): Promise<NodeZlib | undefined> {
  nodeZlibPromise ??= importNodeZlib()
  return nodeZlibPromise
}

async function importNodeZlib(): Promise<NodeZlib | undefined> {
  const specifier = 'node:zlib'

  try {
    return (await import(/* @vite-ignore */ specifier)) as NodeZlib
  } catch {
    return undefined
  }
}
