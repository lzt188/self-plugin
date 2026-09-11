#!/usr/bin/env node
/**
 * Benchmark: cold fold, steady-state refold, incremental fold, and the
 * claude channel, over the real ~/.dsh session logs + ~/.claude JSONL.
 * Scratch analysis tool — prints timings + payload sizes.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { zstdDecompressSync } from 'node:zlib'

process.env.DSH_HOME = join(tmpdir(), `usage-bench-${process.pid}`)

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
    if (!entry.isFile() || !/^session(\.v\d+)?\.jsonl(\.zstd)?$/.test(entry.name)) continue
    const sessionId = entry.name === 'session.jsonl.zstd' || entry.name === 'session.jsonl'
      ? dir.split(/[\\/]/).pop().replace(/^session-/, '')
      : entry.name.replace(/^session\./, '').replace(/\.jsonl(\.zstd)?$/, '')
    const records = await decodeLog(join(dir, entry.name))
    sessions.set(sessionId, records.map((r, i) => ({ ...r, seq: i })))
  }
}
await walk(root)
const totalEvents = [...sessions.values()].reduce((n, e) => n + e.length, 0)
console.log(`sessions: ${sessions.size}  events: ${totalEvents.toLocaleString()}`)

const revisions = new Map([...sessions.keys()].map((id, i) => [id, `rev-${i}`]))
let listCalls = 0
let snapshotCalls = 0
let openCalls = 0
const persistence = {
  // Production JSONL shape: list() returns BARE headers (no revision)…
  async list() {
    listCalls += 1
    return [...sessions.keys()].map((id) => ({ version: 2, id, createdAt: 1, isSeeded: false }))
  },
  // …listSnapshots() carries the stat-derived revision; readFrom is a suffix read.
  async listSnapshots() {
    snapshotCalls += 1
    return [...sessions.keys()].map((id) => ({ header: { version: 2, id, createdAt: 1, isSeeded: false }, revision: revisions.get(id) }))
  },
  async readFrom(id, fromSeq = 0) {
    openCalls += 1
    const events = sessions.get(id) ?? []
    return { events: events.filter((e) => e.seq >= fromSeq) }
  }
}
const ctx = {
  logger: { warn: () => {}, info: () => {}, debug: () => {} },
  get: (service) => (service === 'sessionPersistence' ? persistence : service === 'sessions' ? { list: () => [] } : undefined)
}

const { collectUsage } = await import('../lib/index.js')
const { collectClaudeUsage, resetClaudeState } = await import('../lib/claude.js')

async function time(label, fn) {
  const t0 = performance.now()
  const value = await fn()
  const ms = performance.now() - t0
  console.log(`${label.padEnd(34)} ${ms.toFixed(1).padStart(8)} ms   ${value}`)
  return ms
}

// 1. cold: everything folds from scratch
const cacheFile = join(process.env.DSH_HOME, 'storages', 'usage-cache.json')
const { stat } = await import('node:fs/promises')
async function cacheInfo() {
  try { const s = await stat(cacheFile); return `mtime=${Math.round(s.mtimeMs)} size=${s.size}` } catch { return 'no-cache-file' }
}
let payload = null
await time('cold collectUsage (full fold)', async () => {
  payload = await collectUsage(ctx)
  return `${payload.days.length} days, tokens ${payload.total.tokens.toLocaleString()}`
})
console.log(`  cache after cold: ${await cacheInfo()}`)

// 2. steady state: nothing changed — what does a repeated request cost?
for (let i = 1; i <= 3; i += 1) {
  await time(`warm collectUsage #${i} (no change)`, async () => {
    payload = await collectUsage(ctx)
    return `reads=${openCalls} listSnapshots=${snapshotCalls} list=${listCalls}  ${await cacheInfo()}`
  })
}
const wire = JSON.stringify({ ok: true, ...payload, claude: { enabled: false } })
console.log(`usage payload: ${(wire.length / 1024).toFixed(1)} KiB JSON`)

// 3. incremental: one session grows by 40 usage-bearing events
const busiest = [...sessions.entries()].sort((a, b) => b[1].length - a[1].length)[0]
const [bigId, bigEvents] = busiest
const template = bigEvents.find((e) => e.type === 'assistant/message' && e.data?.usage)
if (template) {
  const extra = []
  for (let i = 0; i < 40; i += 1) extra.push({ ...template, seq: bigEvents.length + i, time: Date.now(), data: { ...template.data, turn: 9000 + i, step: i } })
  sessions.set(bigId, [...bigEvents, ...extra])
  revisions.set(bigId, `rev-${revisions.size}`)
  await time('warm collectUsage (1 session +40)', async () => {
    payload = await collectUsage(ctx)
    return `reads=${openCalls} listSnapshots=${snapshotCalls}  ${await cacheInfo()}`
  })
} else {
  console.log('(no assistant/message usage sample to clone; skipping incremental step)')
}

// 4. claude channel, real ~/.claude
resetClaudeState()
const claudeDeps = {
  claudeDir: join(process.env.USERPROFILE ?? process.env.HOME, '.claude'),
  cachePath: join(process.env.DSH_HOME, 'usage-cache-claude.json'),
  logger: ctx.logger
}
let claudeView = null
await time('claude cold collect', async () => {
  claudeView = await collectClaudeUsage(claudeDeps)
  return `files=${claudeView.files ?? '-'} days=${claudeView.days?.length ?? 0} enabled=${claudeView.enabled}`
})
await time('claude cached collect (in-TTL)', async () => {
  claudeView = await collectClaudeUsage(claudeDeps)
  return `files=${claudeView.files ?? '-'}`
})
if (claudeView?.days) console.log(`claude payload: ${(JSON.stringify(claudeView).length / 1024).toFixed(1)} KiB JSON`)

// 5. cost breakdown of one warm call: how much is merge+render vs disk?
const t0 = performance.now()
const { createUsageState, applyUsageDelta } = await import('../lib/usage.js')
const evs = sessions.get(bigId) ?? []
let n = 0
while (performance.now() - t0 < 250) {
  const st = createUsageState()
  applyUsageDelta(st, evs)
  n += 1
}
console.log(`raw fold of biggest session (${evs.length.toLocaleString()} events): ${(250 / n).toFixed(2)} ms/pass`)
process.exit(0)
