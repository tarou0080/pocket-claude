const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('http')
const fs = require('fs')
const path = require('path')
const os = require('os')
const express = require('express')
const { randomUUID } = require('crypto')

// GET /api/stream（v2.15.0 新プロトコル）のテスト。
// config.LOGS_DIR は require 時に確定するが、実体は各関数が呼び出し時に参照する
// ため、テストではモジュールオブジェクトの LOGS_DIR を差し替えるだけでよい
// （config.json の書き換えは他テストファイルの読み込みと競合するため行わない）。
const config = require('../config/index')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-stream-test-'))
const originalLogsDir = config.LOGS_DIR
config.LOGS_DIR = TMP

const streamRoutes = require('../routes/stream')
const { getState } = require('../services/stream')
const { CLAUDE_PROJECTS_DIR } = require('../services/history')

test.after(() => {
  config.LOGS_DIR = originalLogsDir
  fs.rmSync(TMP, { recursive: true, force: true })
})

function withServer(t) {
  const app = express()
  app.use('/api/stream', streamRoutes)
  const server = app.listen(0)
  t.after(() => server.close())
  const { port } = server.address()
  return `http://127.0.0.1:${port}`
}

function writeMainJsonl(id, lines) {
  fs.writeFileSync(path.join(CLAUDE_PROJECTS_DIR, `${id}.jsonl`),
    lines.map(l => JSON.stringify(l)).join('\n') + '\n')
}

function cleanupMainJsonl(id) {
  try { fs.unlinkSync(path.join(CLAUDE_PROJECTS_DIR, `${id}.jsonl`)) } catch {}
  try { fs.unlinkSync(path.join(TMP, `${id}.jsonl`)) } catch {}
}

// SSE を history-meta まで読む（初回バーストの終端）。サーバーは接続を閉じない
// （ping・tail のため開きっぱなし）ので、クライアント側で meta を見たら切る。
function readSSE(url, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, res => {
      let body = ''
      let done = false
      const finish = () => { if (!done) { done = true; req.destroy(); resolve(body) } }
      const timer = setTimeout(finish, timeoutMs)
      res.on('data', d => {
        body += d
        if (body.includes('event: history-meta\n')) { clearTimeout(timer); finish() }
      })
      res.on('end', () => { clearTimeout(timer); finish() })
      res.on('error', () => { clearTimeout(timer); finish() })
    })
    req.on('error', reject)
  })
}

// SSE テキストを {id, event, data} 配列へパース
function parseSSE(text) {
  const out = []
  for (const block of text.split('\n\n')) {
    if (!block.trim() || block.startsWith(':')) continue
    const rec = { id: undefined, event: undefined, data: undefined }
    for (const line of block.split('\n')) {
      if (line.startsWith('id: ')) rec.id = line.slice(4)
      else if (line.startsWith('event: ')) rec.event = line.slice(7)
      else if (line.startsWith('data: ')) rec.data = JSON.parse(line.slice(6))
    }
    out.push(rec)
  }
  return out
}

const UUID_OK = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const UUID_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

// --- カーソル照合 ---

test('fromAが範囲外ならhistory-meta{reset:true}だけを返す', async (t) => {
  const base = withServer(t)
  const id = randomUUID()
  t.after(() => { cleanupMainJsonl(id); getState(id).buffer = [] })
  writeMainJsonl(id, [{ type: 'user', uuid: UUID_OK, message: { content: 'hi' } }])

  const text = await readSSE(`${base}/api/stream?session=${id}&fromA=10`)
  const evs = parseSSE(text)
  assert.equal(evs.length, 1)
  assert.equal(evs[0].event, 'history-meta')
  assert.equal(evs[0].data.reset, true)
  assert.equal(evs[0].data.maxA, 0)
  assert.equal(evs[0].data.maxB, -1)
})

test('fromBが範囲外でもreset', async (t) => {
  const base = withServer(t)
  const id = randomUUID()
  t.after(() => { cleanupMainJsonl(id); getState(id).buffer = [] })
  writeMainJsonl(id, [{ type: 'user', uuid: UUID_OK, message: { content: 'hi' } }])

  const text = await readSSE(`${base}/api/stream?session=${id}&fromB=5`)
  const evs = parseSSE(text)
  assert.equal(evs.length, 1)
  assert.equal(evs[0].data.reset, true)
})

// --- 履歴再生 ---

test('AとBを織り込んだhistory（id: A<n>/B<n>）を送り、history-metaで締める', async (t) => {
  const base = withServer(t)
  const id = randomUUID()
  t.after(() => { cleanupMainJsonl(id); getState(id).buffer = [] })
  // A: user(0) → assistant(1)。B: after=A0のuuid（A0の後ろへ織り込まれる）
  writeMainJsonl(id, [
    { type: 'user', uuid: UUID_OK, message: { role: 'user', content: 'hi' } },
    { type: 'assistant', uuid: UUID_B, message: { content: [{ type: 'text', text: 'hello' }] } },
  ])
  fs.writeFileSync(path.join(TMP, `${id}.jsonl`),
    JSON.stringify({ type: 'result', after: UUID_OK }) + '\n' +
    JSON.stringify({ type: 'done', exitCode: 0, after: UUID_B }) + '\n')

  const text = await readSSE(`${base}/api/stream?session=${id}`)
  const evs = parseSSE(text)
  const meta = evs[evs.length - 1]
  assert.equal(meta.event, 'history-meta')
  assert.deepEqual(meta.data, { maxA: 1, maxB: 1, external: false })
  // user_input(A0) / result(B0) / stream_event群(A1) / done(B1)
  const ids = evs.filter(e => e.id !== undefined).map(e => e.id)
  assert.deepEqual(ids, ['A0', 'B0', 'A1', 'A1', 'A1', 'B1'])
  // 履歴系は全て event: history
  for (const e of evs.filter(x => x.id !== undefined)) assert.equal(e.event, 'history')
})

test('fromA=1ならA1以降だけを送る（A0のイベント群は出ない）', async (t) => {
  const base = withServer(t)
  const id = randomUUID()
  t.after(() => { cleanupMainJsonl(id); getState(id).buffer = [] })
  writeMainJsonl(id, [
    { type: 'user', uuid: UUID_OK, message: { role: 'user', content: 'hi' } },
    { type: 'assistant', uuid: UUID_B, message: { content: [{ type: 'text', text: 'hello' }] } },
  ])

  const text = await readSSE(`${base}/api/stream?session=${id}&fromA=1`)
  const evs = parseSSE(text)
  const ids = evs.filter(e => e.id !== undefined).map(e => e.id)
  assert.ok(!ids.includes('A0'))
  assert.ok(ids.includes('A1'))
  assert.equal(evs[evs.length - 1].data.maxA, 1)
})

// --- M 再送 ---

test('bufferのうちAに存在する最後のassistant/user以降だけを再送する', async (t) => {
  const base = withServer(t)
  const id = randomUUID()
  const liveUuid = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
  t.after(() => { cleanupMainJsonl(id); getState(id).buffer = [] })
  // A には liveUuid の行はまだ無い（=書きかけ）。UUID_OK の行はある。
  writeMainJsonl(id, [{ type: 'user', uuid: UUID_OK, message: { role: 'user', content: 'hi' } }])
  const s = getState(id)
  s.buffer = [
    { type: 'assistant', uuid: UUID_OK, message: { content: [{ type: 'text', text: 'old' }] } }, // Aに存在→対象外
    { type: 'stream_event', event: { type: 'content_block_start', index: 0 } }, // 対象（生のまま）
    { type: 'assistant', uuid: liveUuid, message: { content: [{ type: 'text', text: 'now' }] } }, // 対象（変換）
    { type: 'stream_event', event: { type: 'content_block_stop', index: 0 } }, // 対象（生のまま）
  ]

  const text = await readSSE(`${base}/api/stream?session=${id}`)
  const evs = parseSSE(text)
  // 変換済みの assistant: claudeEntriesToEvents が1行→3イベント（start/delta/stop）を
  // 出すので、無名の event:history が3つ、全てに uuid が付く
  const converted = evs.filter(e => e.event === 'history' && e.id === undefined)
  assert.equal(converted.length, 3)
  for (const c of converted) assert.equal(c.data.uuid, liveUuid)
  // 生の stream_event が2つ（無名イベント）
  const raw = evs.filter(e => e.event === undefined && e.id === undefined)
  assert.equal(raw.length, 2)
  assert.equal(raw[0].data.type, 'stream_event')
  assert.equal(raw[1].data.type, 'stream_event')
  // 順序: 生start → 変換済みassistant群 → 生stop
  const iStart = evs.findIndex(e => e.data.type === 'stream_event' && e.data.event?.type === 'content_block_start')
  const iConvFirst = evs.findIndex(e => e.event === 'history' && e.id === undefined)
  const iStop = evs.findIndex(e => e.data.type === 'stream_event' && e.data.event?.type === 'content_block_stop')
  assert.ok(iStart !== -1 && iConvFirst !== -1 && iStop !== -1)
  assert.ok(iStart < iConvFirst && iConvFirst < iStop)
})

test('bufferが空ならM再送は何も出さない', async (t) => {
  const base = withServer(t)
  const id = randomUUID()
  t.after(() => { cleanupMainJsonl(id); getState(id).buffer = [] })
  writeMainJsonl(id, [{ type: 'user', uuid: UUID_OK, message: { role: 'user', content: 'hi' } }])

  const text = await readSSE(`${base}/api/stream?session=${id}`)
  const evs = parseSSE(text)
  assert.ok(evs.every(e => e.id !== undefined || e.event === 'history-meta'))
})

// --- バリデーション ---

test('session無しは400・不正IDは400', async (t) => {
  const base = withServer(t)
  assert.equal((await fetch(`${base}/api/stream`)).status, 400)
  assert.equal((await fetch(`${base}/api/stream?session=not-a-uuid`)).status, 400)
})
