const test = require('node:test')
const assert = require('node:assert/strict')
const { slimEventsForReplay } = require('../services/history')

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
