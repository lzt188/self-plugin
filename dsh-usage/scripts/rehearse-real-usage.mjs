#!/usr/bin/env node
/**
 * Rehearsal: drive the FIXED dsh-usage fold over the real ~/.dsh session logs
 * through the current harness API shapes, and verify the incremental fold is
 * slice-invariant (steady state == one-shot refold).
 */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { zstdDecompressSync } from 'node:zlib'
import assert from 'node:assert/strict'

process.env.DSH_HOME = join(tmpdir(), `usage-rehearsal-${process.pid}`)

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

async function decodeLog(path) {
  const raw = await readFile(path)
  const lines = []
  if (path.endsWith('.zstd')) {
    for (const f of scanFrames(raw)) {
      const text = zstdDecompressSync(raw.subarray(f.start, f.end)).toString('utf8')
      for (const l of text.split('\n')) if (l.trim()) lines.push(l)
    }
  } else {
    for (const l of raw.toString('utf8').split('\n')) if (l.trim()) lines.push(l)
  }
  return lines.map((l) => JSON.parse(l)).filter((r) => r.type !== 'session')
}

const root = join(process.env.USERPROFILE ?? process.env.HOME, '.dsh', 'sessions')
const sessions = new Map()
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) { await walk(join(dir, entry.name)); continue }
    if (!/^session\.v\d+\.jsonl(\.zstd)?$/.test(entry.name)) continue
    const id = entry.name.replace(/^session\./, '').replace(/\.jsonl(\.zstd)?$/, '')
    const records = await decodeLog(join(dir, entry.name))
    // Re-key to logical seq: the header line is not an event.
    sessions.set(dir.split(/[\\/]/).pop() + '/' + (records[0]?.id ?? id), records.map((r, i) => ({ ...r, seq: i })))
  }
}
await walk(root)
console.log(`real sessions loaded: ${sessions.size}`)

// ---- persistence fake in the CURRENT harness shape ----
const revisions = new Map([...sessions.keys()].map((id, i) => [id, `rev-${i}`]))
const reads = []
const persistence = {
  async list() {
    return [...sessions.keys()].map((id) => ({ header: { version: 2, id, createdAt: 1, isSeeded: false }, revision: revisions.get(id) }))
  },
  async open(id) {
    reads.push(id)
    const events = sessions.get(id) ?? []
    return { id, async read(offset = 0) { return events.filter((e) => e.seq >= offset) }, async close() {} }
  }
}
const ctx = {
  logger: { warn: (m) => console.log('  [warn]', m), info: () => {}, debug: () => {} },
  get: (service) => (service === 'sessionPersistence' ? persistence : service === 'sessions' ? { list: () => [] } : undefined)
}

const { collectUsage } = await import('../lib/index.js')
const { applyUsageDelta, createUsageState, mergeInto, mergeHoursInto, mergeModelHoursInto, renderUsage, foldUsage } = await import('../lib/usage.js')

const result = await collectUsage(ctx)
console.log(`\nread handles opened: ${reads.length}`)
console.log(`days: ${result.days.length}   total tokens: ${result.total.tokens.toLocaleString()}`)
console.log(`cacheHitRate: ${result.total.cacheHitRate}%  in=${result.total.inputTokens} out=${result.total.outputTokens} cacheRead=${result.total.cacheReadTokens}`)
const modelTotals = new Map()
for (const day of result.days) for (const m of day.models) modelTotals.set(m.model, (modelTotals.get(m.model) ?? 0) + m.tokens)
console.log('\nper-model tokens:')
for (const [m, t] of [...modelTotals].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${t.toLocaleString().padStart(12)}  ${m}`)
console.log('\nlast 5 days:')
for (const d of result.days.slice(-5)) console.log(`  ${d.date}  ${d.tokens.toLocaleString().padStart(11)} tokens  hit=${d.cacheHitRate}%  models=${d.models.length}`)

assert.ok(result.total.tokens > 0, 'REAL USAGE MUST PRODUCE NON-ZERO TOKENS')
assert.ok(reads.length > 0, 'persisted sessions must actually be read')

// ---- invariant: incremental slicing must equal a one-shot fold ----
let mismatch = 0
for (const [id, events] of sessions) {
  const oneShot = foldUsage(events)
  for (const size of [1, 2, 3, 7, 13]) {
    const state = createUsageState()
    for (let i = 0; i < events.length; i += size) applyUsageDelta(state, events.slice(i, i + size))
    const a = JSON.stringify([...oneShot].map(([d, e]) => [d, e.totals, [...e.models]]).sort())
    const b = JSON.stringify([...state.days].map(([d, e]) => [d, e.totals, [...e.models]]).sort())
    if (a !== b) { mismatch++; console.log(`  MISMATCH ${id} slice=${size}`) }
  }
}
console.log(`\nslice-invariance check: ${mismatch === 0 ? 'PASS (all sessions, all slice sizes)' : `${mismatch} MISMATCHES`}`)
assert.equal(mismatch, 0)
console.log('\nREHEARSAL OK')
