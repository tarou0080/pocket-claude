const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { randomUUID } = require('crypto')
const { slimEventsForReplay, getSessionEvents, CLAUDE_PROJECTS_DIR } = require('../services/history')
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

// getSessionEvents() の log_start 境界（v2.12.2）。
// pocketログの寿命＝claudeプロセスの寿命になったことに伴い、cutCurrentTurn（本体jsonl変換後の
// テキスト照合で現在ターンを切り落とす方式）を撤去し、pocketログ先頭の log_start 行が持つ
// mainLines（このpocketログが積まれ始めた時点の本体jsonl非空行数）で境界を決める方式へ
// 差し替えた。実ファイル（CLAUDE_PROJECTS_DIR・config.LOGS_DIR）に直接書き込んで検証する
// （services/history.js は依存注入に対応していないため。test/stream.test.js と同じ方針）。

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
    { type: 'user', message: { content: 'turn1' } },
    { type: 'user', message: { content: 'turn2' } },
  ]
  fs.writeFileSync(mainJsonlPath(id), lines.map(l => JSON.stringify(l)).join('\n') + '\n')

  const out = getSessionEvents(id)
  assert.deepEqual(out.map(e => e.text), ['turn1', 'turn2'])
})

test('pocketログのlog_start.mainLinesで本体jsonlをsliceする', () => {
  const id = testSessionId()
  const lines = [
    { type: 'user', message: { content: 'turn1' } },
    { type: 'user', message: { content: 'turn2 (進行中ターン、pocketログ側で配信される)' } },
  ]
  fs.writeFileSync(mainJsonlPath(id), lines.map(l => JSON.stringify(l)).join('\n') + '\n')
  // log_start.mainLines=1 → 本体jsonlはturn1までしか含めない
  fs.writeFileSync(pocketLogPath(id), JSON.stringify({ type: 'log_start', mainLines: 1, epoch: 123, timestamp: 't' }) + '\n')

  const out = getSessionEvents(id)
  assert.deepEqual(out.map(e => e.text), ['turn1'])
})

test('pocketログの先頭行がlog_startでない（旧形式）ならmainLines=0扱いで本体jsonlは含めない', () => {
  const id = testSessionId()
  const lines = [
    { type: 'user', message: { content: 'turn1' } },
  ]
  fs.writeFileSync(mainJsonlPath(id), lines.map(l => JSON.stringify(l)).join('\n') + '\n')
  fs.writeFileSync(pocketLogPath(id), JSON.stringify({ type: 'user_input', text: 'old-format live line' }) + '\n')

  const out = getSessionEvents(id)
  assert.deepEqual(out, [])
})
