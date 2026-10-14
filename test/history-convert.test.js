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

test('thinking は写さない（CLI の会話画面は考えた跡を残さない。考え中の表示はライブだけ）', () => {
  const out = claudeEntriesToEvents([
    { type: 'assistant', timestamp: 't', message: { content: [
      { type: 'thinking', thinking: 'reasoning...', signature: 'sig' },
    ] } },
  ])
  assert.deepEqual(out, [])
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

test('user の文字列 content：通常プロンプトは user_input、コマンド出力は system 行（タグを剥がす）', () => {
  const out = claudeEntriesToEvents([
    { type: 'user', timestamp: 't1', message: { content: 'just a prompt' } },
    { type: 'user', timestamp: 't2', message: { content: '<local-command-stdout>Set model to opus</local-command-stdout>' } },
    { type: 'user', timestamp: 't3', message: { content: '<bash-stdout>hi</bash-stdout>' } },
    { type: 'user', timestamp: 't4', message: { content: '<local-command-stdout></local-command-stdout>' } },
  ])
  assert.deepEqual(out, [
    { type: 'user_input', text: 'just a prompt', timestamp: 't1' },
    { type: 'system', text: 'Set model to opus', timestamp: 't2' },
    { type: 'system', text: 'hi', timestamp: 't3' },
  ])
})

test('スラッシュコマンド・シェル実行は CLI と同じく打った形（/model fable・! ls）の発言になる', () => {
  const out = claudeEntriesToEvents([
    { type: 'user', timestamp: 't1', message: { content: '<command-name>/model</command-name>\n            <command-message>model</command-message>\n            <command-args>fable</command-args>' } },
    { type: 'user', timestamp: 't2', message: { content: '<command-message>compact</command-message>\n<command-name>/compact</command-name>' } },
    { type: 'user', timestamp: 't3', message: { content: '<bash-input>ls -la</bash-input>' } },
  ])
  assert.deepEqual(out, [
    { type: 'user_input', text: '/model fable', timestamp: 't1' },
    { type: 'user_input', text: '/compact', timestamp: 't2' },
    { type: 'user_input', text: '! ls -la', timestamp: 't3' },
  ])
})

test('停止の印は発言でなく requestInterrupted の system 行（CLI: Interrupted · …）', () => {
  const out = claudeEntriesToEvents([
    { type: 'user', timestamp: 't1', message: { content: [{ type: 'text', text: '[Request interrupted by user]' }] } },
    { type: 'user', timestamp: 't2', message: { content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] } },
  ])
  assert.deepEqual(out, [
    { type: 'system', key: 'requestInterrupted', timestamp: 't1' },
    { type: 'system', key: 'requestInterrupted', timestamp: 't2' },
  ])
})

test('圧縮の要約（isCompactSummary・stdout の isSynthetic）とコマンド前の注意書き（isMeta）は写さない', () => {
  const out = claudeEntriesToEvents([
    { type: 'user', timestamp: 't1', isCompactSummary: true, isVisibleInTranscriptOnly: true, message: { content: 'This session is being continued...' } },
    { type: 'user', timestamp: 't2', isSynthetic: true, message: { content: 'This session is being continued...' } },
    { type: 'user', timestamp: 't3', isMeta: true, message: { content: '<local-command-caveat>Caveat: ...</local-command-caveat>' } },
  ])
  assert.deepEqual(out, [])
})

test('system 行: 圧縮の区切り・コマンドの記録・警告だけを写す', () => {
  const out = claudeEntriesToEvents([
    { type: 'system', subtype: 'compact_boundary', level: 'info', content: 'Conversation compacted', timestamp: 't1',
      compactMetadata: { trigger: 'auto', preTokens: 266797, postTokens: 6475 } },
    { type: 'system', subtype: 'local_command', level: 'info', content: '/login', timestamp: 't2' },
    { type: 'system', subtype: 'local_command', level: 'info', content: "<local-command-stdout>/login isn't available in this environment.</local-command-stdout>", timestamp: 't3' },
    { type: 'system', subtype: 'model_consent_fallback', level: 'warning', content: 'Switched to Sonnet 5 for this session', timestamp: 't4' },
    { type: 'system', subtype: 'informational', level: 'notice', content: 'safeguards stopped the response above', timestamp: 't5' },
    { type: 'system', subtype: 'api_error', level: 'error', timestamp: 't6' },
    { type: 'system', subtype: 'turn_duration', level: 'info', content: 'x', timestamp: 't7' },
  ])
  assert.deepEqual(out, [
    { type: 'system', key: 'conversationCompacted', params: { from: '267K', to: '6K', postTokens: 6475 }, timestamp: 't1' },
    { type: 'user_input', text: '/login', timestamp: 't2' },
    { type: 'system', text: "/login isn't available in this environment.", timestamp: 't3' },
    { type: 'system', text: 'Switched to Sonnet 5 for this session', timestamp: 't4' },
    { type: 'system', text: 'safeguards stopped the response above', timestamp: 't5' },
  ])
  // 再生用の間引き（slim）を通しても key 付きの行は残る
  assert.equal(slimEventsForReplay(out).length, out.length)
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

test('attachment{queued_command}（ターン中に届いた送信）は user 行と同じく user_input になる', () => {
  const out = claudeEntriesToEvents([
    { type: 'attachment', timestamp: 't', attachment: { type: 'queued_command', commandMode: 'prompt',
      prompt: [{ type: 'text', text: '途中で送った' }, { type: 'image', source: {} }] } },
    { type: 'attachment', timestamp: 't2', attachment: { type: 'queued_command', commandMode: 'task-notification',
      prompt: '<task-notification>\n<task-id>x</task-id>\n</task-notification>' } },
    { type: 'attachment', timestamp: 't3', attachment: { type: 'environment' } },
  ])
  assert.deepEqual(out, [
    { type: 'user_input', text: '途中で送った', timestamp: 't' },
    { type: 'system', text: '[image]', timestamp: 't' },
    { type: 'user_input', text: '<task-notification>\n<task-id>x</task-id>\n</task-notification>', timestamp: 't2' },
  ])
})

test('isMeta の user 行（スキル本文・画像注記）は写さない＝ユーザー発言として描かない', () => {
  const out = claudeEntriesToEvents([
    { type: 'user', timestamp: 't', isMeta: true,
      message: { content: [{ type: 'text', text: 'Base directory for this skill: /tmp/x\n\n# Skill' }] } },
    { type: 'user', timestamp: 't2', isMeta: true, message: { content: '[Image: original 1080x2160]' } },
    { type: 'user', timestamp: 't3', message: { content: '本当の発言' } },
  ])
  assert.deepEqual(out, [{ type: 'user_input', text: '本当の発言', timestamp: 't3' }])
})

test('ターン終端イベント(done/result)を足さない（block stop が描画を閉じる）', () => {
  const out = claudeEntriesToEvents([
    { type: 'user', timestamp: 't', message: { content: 'q' } },
    { type: 'assistant', timestamp: 't', message: { content: [{ type: 'text', text: 'a' }] } },
  ])
  assert.equal(out.some(e => e.type === 'done' || e.type === 'result'), false)
})

test('複数ブロック（thinking→tool_use→text）は thinking を除いて index を進めながら順に出る', () => {
  const out = claudeEntriesToEvents([
    { type: 'assistant', timestamp: 't', message: { content: [
      { type: 'thinking', thinking: 'x' },
      { type: 'tool_use', id: 'u1', name: 'Read', input: { file: 'a' } },
      { type: 'text', text: 'done' },
    ] } },
  ])
  const starts = out.filter(e => e.event && e.event.type === 'content_block_start')
  assert.deepEqual(starts.map(e => e.event.index), [0, 1])
  assert.deepEqual(starts.map(e => e.event.content_block.type), ['tool_use', 'text'])
  // slim を通しても順序・種別が保たれる
  const slim = slimEventsForReplay(out)
  const slimStarts = slim.filter(e => e.event && e.event.type === 'content_block_start')
  assert.deepEqual(slimStarts.map(e => e.event.content_block.type), ['tool_use', 'text'])
})
