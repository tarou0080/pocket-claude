const test = require('node:test')
const assert = require('node:assert/strict')
const { claudeEntriesToEvents } = require('../services/history-convert')
const { slimEventsForReplay } = require('../services/history')

// claudeEntriesToEvents は ~/.claude/projects/<id>.jsonl のパース済み行を
// pocket-claude の画面イベント（ライブ配信と同じ語彙）へ正規化する。
// v2.11.0までの変換はテキストブロックのみだった。ここでは強化分（tool_use /
// tool_result / thinking / image）が正しい語彙へ落ちること、および出力が
// slimEventsForReplay を通過しても壊れないことを検証する。

test('assistant のテキストブロックは content_block チェーン（text_delta）へ変換される', () => {
  const out = claudeEntriesToEvents([
    { type: 'assistant', timestamp: 't1', message: { content: [{ type: 'text', text: 'hello' }] } },
  ])
  assert.deepEqual(out, [
    { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, timestamp: 't1' },
    { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello' } }, timestamp: 't1' },
    { type: 'stream_event', event: { type: 'content_block_stop', index: 0 }, timestamp: 't1' },
  ])
})

test('tool_use は content_block_start(tool_use)+input_json_delta(JSON.stringify(input))+stop へ変換される', () => {
  const out = claudeEntriesToEvents([
    { type: 'assistant', timestamp: 't', message: { content: [
      { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls', description: 'd' } },
    ] } },
  ])
  assert.equal(out.length, 3)
  assert.deepEqual(out[0].event.content_block, { type: 'tool_use', id: 'toolu_1', name: 'Bash' })
  assert.equal(out[1].event.delta.type, 'input_json_delta')
  assert.deepEqual(JSON.parse(out[1].event.delta.partial_json), { command: 'ls', description: 'd' })
  assert.equal(out[2].event.type, 'content_block_stop')
})

test('thinking は start(thinking)+thinking_delta+stop（本文はslimで落ちるがブロックは伝わる）', () => {
  const out = claudeEntriesToEvents([
    { type: 'assistant', timestamp: 't', message: { content: [
      { type: 'thinking', thinking: 'reasoning...', signature: 'sig' },
    ] } },
  ])
  assert.equal(out[0].event.content_block.type, 'thinking')
  assert.equal(out[1].event.delta.type, 'thinking_delta')
  assert.equal(out[2].event.type, 'content_block_stop')

  // slim 後は thinking_delta が消え、start+stop だけが残る（フロントは [thinking done] を出す）
  const slim = slimEventsForReplay(out)
  assert.equal(slim.length, 2)
  assert.equal(slim[0].event.type, 'content_block_start')
  assert.equal(slim[1].event.type, 'content_block_stop')
})

test('user の tool_result は type:user（tool_result ブロック配列）へ変換される', () => {
  const out = claudeEntriesToEvents([
    { type: 'user', timestamp: 't', message: { content: [
      { type: 'tool_result', tool_use_id: 'toolu_1', content: 'output text', is_error: false },
    ] } },
  ])
  assert.deepEqual(out, [
    { type: 'user', message: { content: [
      { type: 'tool_result', tool_use_id: 'toolu_1', content: 'output text', is_error: false },
    ] }, timestamp: 't' },
  ])
})

test('user のテキスト＋画像混在：user_input(text) と system("[image]") マーカーを出す', () => {
  const out = claudeEntriesToEvents([
    { type: 'user', timestamp: 't', message: { content: [
      { type: 'text', text: 'look at this' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
    ] } },
  ])
  assert.deepEqual(out, [
    { type: 'user_input', text: 'look at this', timestamp: 't' },
    { type: 'system', text: '[image]', timestamp: 't' },
  ])
})

test('user の文字列 content：通常プロンプトは user_input、<local-command-stdout> は type:user', () => {
  const out = claudeEntriesToEvents([
    { type: 'user', timestamp: 't1', message: { content: 'just a prompt' } },
    { type: 'user', timestamp: 't2', message: { content: '<local-command-stdout>Set model to opus</local-command-stdout>' } },
  ])
  assert.deepEqual(out[0], { type: 'user_input', text: 'just a prompt', timestamp: 't1' })
  assert.deepEqual(out[1], { type: 'user', message: { content: '<local-command-stdout>Set model to opus</local-command-stdout>' }, timestamp: 't2' })
})

test('since より後のエントリだけを変換する（履歴の穴埋め用）', () => {
  const out = claudeEntriesToEvents([
    { type: 'user', timestamp: '2026-01-01T00:00:00Z', message: { content: 'old' } },
    { type: 'user', timestamp: '2026-01-03T00:00:00Z', message: { content: 'new' } },
  ], { since: '2026-01-02T00:00:00Z' })
  assert.deepEqual(out, [{ type: 'user_input', text: 'new', timestamp: '2026-01-03T00:00:00Z' }])
})

test('非会話エントリ（queue-operation / attachment / ai-title 等）は写さない', () => {
  const out = claudeEntriesToEvents([
    { type: 'queue-operation', operation: 'enqueue' },
    { type: 'attachment', attachment: {} },
    { type: 'ai-title', aiTitle: 'x' },
    { type: 'summary', summary: 's' },
  ])
  assert.deepEqual(out, [])
})

test('ターン終端イベント(done/result)を足さない（block stop が描画を閉じる）', () => {
  const out = claudeEntriesToEvents([
    { type: 'user', timestamp: 't', message: { content: 'q' } },
    { type: 'assistant', timestamp: 't', message: { content: [{ type: 'text', text: 'a' }] } },
  ])
  assert.equal(out.some(e => e.type === 'done' || e.type === 'result'), false)
})

test('複数ブロック（thinking→tool_use→text）は index を進めながら順に出る', () => {
  const out = claudeEntriesToEvents([
    { type: 'assistant', timestamp: 't', message: { content: [
      { type: 'thinking', thinking: 'x' },
      { type: 'tool_use', id: 'u1', name: 'Read', input: { file: 'a' } },
      { type: 'text', text: 'done' },
    ] } },
  ])
  const starts = out.filter(e => e.event && e.event.type === 'content_block_start')
  assert.deepEqual(starts.map(e => e.event.index), [0, 1, 2])
  assert.deepEqual(starts.map(e => e.event.content_block.type), ['thinking', 'tool_use', 'text'])
  // slim を通しても順序・種別が保たれる
  const slim = slimEventsForReplay(out)
  const slimStarts = slim.filter(e => e.event && e.event.type === 'content_block_start')
  assert.deepEqual(slimStarts.map(e => e.event.content_block.type), ['thinking', 'tool_use', 'text'])
})
