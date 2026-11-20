import { promises as fs } from 'fs'
import { promisify } from 'util'
import { t } from './i18n.mjs'

async function tailStart(file, size, lines, buffer) {
  if (lines === 0) return size
  let offset = size
  while (offset > 0) {
    const length = Math.min(offset, buffer.length)
    offset -= length
    const { bytesRead } = await file.read(buffer, 0, length, offset)
    for (let i = bytesRead - 1; i >= 0; i--) {
      // A final newline terminates the last line. It does not start another.
      if (buffer[i] === 10 && offset + i !== size - 1 && --lines === 0) return offset + i + 1
    }
  }
  return 0
}

export async function writeLog(path, tail, output) {
  if (tail !== undefined && (!/^\d+$/.test(tail) || !Number.isSafeInteger(Number(tail)))) throw new Error(t('logs.invalid_tail'))
  let file
  try {
    file = await fs.open(path, 'r')
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
    console.error(t('logs.empty', { path }))
    return
  }
  // A Writable reports a failed write both to its callback and as an event.
  // Await the callback for backpressure, including on the final chunk.
  const write = promisify(output.write.bind(output))
  const onError = () => {}
  output.on('error', onError)
  try {
    const { size } = await file.stat()
    const buffer = Buffer.alloc(64 * 1024)
    let offset = tail === undefined ? 0 : await tailStart(file, size, Number(tail), buffer)
    while (offset < size) {
      const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, size - offset), offset)
      if (!bytesRead) break // The file was truncated while reading.
      try {
        await write(buffer.subarray(0, bytesRead))
      } catch (err) {
        if (err.code === 'EPIPE') return
        throw err
      }
      offset += bytesRead
    }
  } finally {
    await file.close()
    output.removeListener('error', onError)
  }
}
