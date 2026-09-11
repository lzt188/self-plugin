#!/usr/bin/env node
/**
 * Measure what a "full physical reload" of the real ~/.dsh logs costs —
 * the cost a per-request re-read pays if revision-based skipping fails.
 * Parts: read + frame-scan/trial-decompress (sync) vs async decompress vs JSON.parse.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { zstdDecompress, zstdDecompressSync } from 'node:zlib'
import { promisify } from 'node:util'

const decompress = promisify(zstdDecompress)

const MAGIC = 0xfd2fb528
function scanFrames(buffer) {
  const out = []
  let offset = 0
  while (offset + 5 <= buffer.length) {
    const start = offset
    if (buffer.readUInt32LE(offset) !== MAGIC) break
    offset += 4
    const fhd = buffer[offset]; offset += 1
    offset += [0, 1, 2, 4][fhd & 0x03]
    if ((fhd & 0x20) === 0) offset += 1
    let next = buffer.length
    for (let i = offset; i + 4 <= buffer.length; i += 1) if (buffer.readUInt32LE(i) === MAGIC) { next = i; break }
    try { zstdDecompressSync(buffer.subarray(start, next)); out.push({ start, end: next }) } catch { break }
    offset = next
  }
  return out
}

const root = join(process.env.USERPROFILE ?? process.env.HOME, '.dsh', 'sessions')
const paths = []
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) { await walk(join(dir, entry.name)); continue }
    if (entry.isFile() && entry.name.endsWith('.jsonl.zstd')) paths.push(join(dir, entry.name))
  }
}
await walk(root)

let scanMs = 0, asyncMs = 0, parseMs = 0, bytes = 0, plainBytes = 0, lines = 0
for (const p of paths) {
  const raw = await readFile(p)
  bytes += raw.length
  const t0 = performance.now()
  const frames = scanFrames(raw) // trial sync decompress to validate frame bounds
  scanMs += performance.now() - t0
  const texts = []
  for (const f of frames) {
    const t1 = performance.now()
    const buf = await decompress(raw.subarray(f.start, f.end))
    asyncMs += performance.now() - t1
    plainBytes += buf.length
    texts.push(buf.toString('utf8'))
  }
  const t2 = performance.now()
  for (const c of texts) for (const line of c.split('\n')) { if (line.trim()) { JSON.parse(line); lines += 1 } }
  parseMs += performance.now() - t2
}
console.log(`logs: ${paths.length}  compressed: ${(bytes / 1048576).toFixed(1)} MiB  plain: ${(plainBytes / 1048576).toFixed(1)} MiB  lines: ${lines.toLocaleString()}`)
console.log(`frame scan w/ trial sync decompress: ${scanMs.toFixed(0)} ms`)
console.log(`async zstd decompress:               ${asyncMs.toFixed(0)} ms`)
console.log(`JSON.parse everything:               ${parseMs.toFixed(0)} ms`)
console.log(`full reload total ≈ ${(scanMs + asyncMs + parseMs).toFixed(0)} ms`)
process.exit(0)
