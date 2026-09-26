const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { randomUUID } = require('crypto')
// 本番の ~/.claude に触れない（CLAUDE_CONFIG_DIR を一時ディレクトリへ向ける。services の require より前に置く）。
const claudeTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-history-claude-'))
process.env.CLAUDE_CONFIG_DIR = claudeTmp
test.after(() => fs.rmSync(claudeTmp, { recursive: true, force: true }))

const { slimEventsForReplay, getSessionEvents, buildConversation, weave, CLAUDE_PROJECTS_DIR } = require('../services/history')
fs.mkdirSync(CLAUDE_PROJECTS_DIR, { recursive: true })
const config = require('../config/index')

// slimEventsForReplay() は履歴再生専用にイベント列を整理する純粋関数。
// クライアントの描画結果（handleEventの出力）が1バイトも変わらないことが条件。
// services/history.js のコメントに書かれている4つの除去規則＋delta連結を
// そのまま仕様として検証する。

test('type:assistant はrate_limitエラーでなければ除去される（本文はstream_eventで描画済みの重複）', () => {
  const events = [
    { type: 'assistant', text: 'dup' },
    { type: 'assistant', error: 'rate_limit', text: 'kept' },
  ]
  const out = slimEventsForReplay(events)
  assert.deepEqual(out, [{ type: 'assistant', error: 'rate_limit', text: 'kept' }])
})

test('type:system はsubtype:init以外かつtext無しなら除去される', () => {
  const events = [
    { type: 'system', subtype: 'init' },
    { type: 'system', subtype: 'other', text: 'has text' },
    { type: 'system', subtype: 'other' },
  ]
  const out = slimEventsForReplay(events)
  assert.deepEqual(out, [
    { type: 'system', subtype: 'init' },
    { type: 'system', subtype: 'other', text: 'has text' },
  ])
})

test('signature_delta/thinking_deltaのstream_eventは除去される', () => {
  const events = [
    { type: 'stream_event', event: { delta: { type: 'signature_delta' } } },
    { type: 'stream_event', event: { delta: { type: 'thinking_delta' } } },
    { type: 'stream_event', event: { type: 'content_block_start', index: 0 } },
  ]
  const out = slimEventsForReplay(events)
  assert.deepEqual(out, [{ type: 'stream_event', event: { type: 'content_block_start', index: 0 } }])
})

test('user の tool_use_result フィールドは除去され、他フィールドは残る', () => {
  const events = [
    { type: 'user', message: { content: 'hi' }, tool_use_result: { big: 'blob' } },
  ]
  const out = slimEventsForReplay(events)
  assert.deepEqual(out, [{ type: 'user', message: { content: 'hi' } }])
})

test('連続するtext_deltaは直前の要素へ連結される', () => {
  const events = [
    { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'He' } } },
    { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'llo' } } },
  ]
  const out = slimEventsForReplay(events)
  assert.equal(out.length, 1)
  assert.equal(out[0].event.delta.text, 'Hello')
})

test('content_block_start/stopを挟むと連結が打ち切られる（別の要素として残る）', () => {
  const events = [
    { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'a' } } },
    { type: 'stream_event', event: { type: 'content_block_stop', index: 0 } },
    { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'b' } } },
  ]
  const out = slimEventsForReplay(events)
  assert.equal(out.length, 3)
  assert.equal(out[0].event.delta.text, 'a')
  assert.equal(out[2].event.delta.text, 'b')
})

test('input_json_deltaはtext_deltaと別系列として連結される（partial_jsonの結合）', () => {
  const events = [
    { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"a":' } } },
    { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '1}' } } },
  ]
  const out = slimEventsForReplay(events)
  assert.equal(out.length, 1)
  assert.equal(out[0].event.delta.partial_json, '{"a":1}')
})

test('入力配列・要素を破壊的に書き換えない', () => {
  const original = { type: 'user', message: {}, tool_use_result: { x: 1 } }
  const events = [original]
  slimEventsForReplay(events)
  assert.deepEqual(original, { type: 'user', message: {}, tool_use_result: { x: 1 } })
})

// weave() の after 織り込み（v2.15.0）。
// A＝本体jsonl（各行にuuid）、B＝pocketログ（各行にafter: <uuid|null>）。
// BはafterでAの織り込み位置を自ら指定する。complete条件4の3ケース＋αを検証する。

function aLinesFixture() {
  // A 3行（uuid a0..a2）。user1行＋assistant2行（各1テキストブロック）。
  return [
    JSON.stringify({ type: 'user', uuid: 'a0', timestamp: 't0', message: { content: 'turn1' } }),
    JSON.stringify({ type: 'assistant', uuid: 'a1', timestamp: 't1', message: { content: [{ type: 'text', text: 'resp1' }] } }),
    JSON.stringify({ type: 'assistant', uuid: 'a2', timestamp: 't2', message: { content: [{ type: 'text', text: 'resp2' }] } }),
  ]
}

test('weave: fromA=0 で start→A0→A1→result→A2→done の順に織り込まれる', () => {
  const A = aLinesFixture()
  const B = [
    JSON.stringify({ type: 'start', after: null }),
    JSON.stringify({ type: 'result', after: 'a1' }),
    JSON.stringify({ type: 'done', after: 'zz' }),
  ]
  const { events, maxA, maxB } = weave(A, B, { fromA: 0, fromB: 0 })

  const kinds = events.map(e => {
    if (e.id.startsWith('A')) return `A${e.ev.type}:${e.ev.text || ''}`
    return `B${e.ev.type}`
  })
  assert.deepEqual(kinds, [
    'Bstart',
    'Auser_input:turn1',
    'Astream_event:',
    'Astream_event:',
    'Astream_event:',
    'Bresult',
    'Astream_event:',
    'Astream_event:',
    'Astream_event:',
    'Bdone',
  ])
  assert.equal(maxA, 2)
  assert.equal(maxB, 2)
})

test('weave: fromA=2 なら描画済み行（a1）を指すresultは先頭、A2→done が続く', () => {
  const A = aLinesFixture()
  const B = [
    JSON.stringify({ type: 'start', after: null }),
    JSON.stringify({ type: 'result', after: 'a1' }),
    JSON.stringify({ type: 'done', after: 'zz' }),
  ]
  const { events } = weave(A, B, { fromA: 2, fromB: 0 })
  const kinds = events.map(e => e.id.startsWith('A') ? `A${e.ev.type}` : `B${e.ev.type}`)
  // startはafter:null→先頭へ。resultはA[:2]（描画済み）を指す→先頭へ。A2の直後に来るBは無い。
  assert.deepEqual(kinds, ['Bstart', 'Bresult', 'Astream_event', 'Astream_event', 'Astream_event', 'Bdone'])
})

test('weave: Bイベントにはuuidが付与され、A行由来のevにもuuidが付く', () => {
  const A = aLinesFixture()
  const B = [JSON.stringify({ type: 'result', after: 'a1' })]
  const { events } = weave(A, B, { fromA: 0 })
  const user = events.find(e => e.id === 'A0')
  assert.equal(user.ev.uuid, 'a0')
  const result = events.find(e => e.id === 'B0')
  assert.equal(result.ev.type, 'result')
})

test('weave: ファイル無し（空配列）ならmaxA/maxBは-1', () => {
  const { maxA, maxB } = weave([], [])
  assert.equal(maxA, -1)
  assert.equal(maxB, -1)
})

test('weave: fromB以降のB行だけ織り込まれる', () => {
  const A = aLinesFixture()
  const B = [
    JSON.stringify({ type: 'start', after: null }),
    JSON.stringify({ type: 'result', after: 'a1' }),
    JSON.stringify({ type: 'done', after: 'zz' }),
  ]
  const { events } = weave(A, B, { fromA: 0, fromB: 1 })
  const bIds = events.filter(e => e.id.startsWith('B')).map(e => e.id)
  assert.deepEqual(bIds, ['B1', 'B2'])
})

// getSessionEvents() は buildConversation の薄いラッパー（実ファイル経由）。

function mainJsonlPath(id) { return path.join(CLAUDE_PROJECTS_DIR, `${id}.jsonl`) }
function pocketLogPath(id) { return path.join(config.LOGS_DIR, `${id}.jsonl`) }

let usedIds = []
function testSessionId() {
  const id = randomUUID()
  usedIds.push(id)
  return id
}

test.afterEach(() => {
  for (const id of usedIds) {
    try { fs.unlinkSync(mainJsonlPath(id)) } catch {}
    try { fs.unlinkSync(pocketLogPath(id)) } catch {}
  }
  usedIds = []
})

test('pocketログが無ければ本体jsonl全部を返す', () => {
  const id = testSessionId()
  const lines = [
    { type: 'user', uuid: 'a0', message: { content: 'turn1' } },
    { type: 'user', uuid: 'a1', message: { content: 'turn2' } },
  ]
  fs.writeFileSync(mainJsonlPath(id), lines.map(l => JSON.stringify(l)).join('\n') + '\n')

  const out = getSessionEvents(id)
  assert.deepEqual(out.map(e => e.text), ['turn1', 'turn2'])
})

test('buildConversation: A＋B（after付き）を織り込んで返す', () => {
  const id = testSessionId()
  const aLines = aLinesFixture()
  const bLines = [
    JSON.stringify({ type: 'start', after: null }),
    JSON.stringify({ type: 'result', after: 'a1' }),
  ]
  fs.writeFileSync(mainJsonlPath(id), aLines.join('\n') + '\n')
  fs.writeFileSync(pocketLogPath(id), bLines.join('\n') + '\n')

  const conv = buildConversation(id)
  assert.equal(conv.maxA, 2)
  assert.equal(conv.maxB, 1)
  const kinds = conv.events.map(e => e.id.startsWith('A') ? `A${e.ev.type}` : `B${e.ev.type}`)
  assert.deepEqual(kinds, ['Bstart', 'Auser_input', 'Astream_event', 'Astream_event', 'Astream_event', 'Bresult', 'Astream_event', 'Astream_event', 'Astream_event'])
  // A行由来のイベントにはA行のuuidが付く
  const a0 = conv.events.find(e => e.id === 'A0')
  assert.equal(a0.ev.uuid, 'a0')
})
