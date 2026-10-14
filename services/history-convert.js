// Claude Code の会話jsonl（~/.claude/projects/<id>.jsonl のパース済み行配列）を
// pocket-claude の画面イベント列へ変換する。
//
// 方針（設計の背景「特別扱いを増やさない」「薄いラッパー」の踏襲）:
//  - 出力はライブ配信(SSE)と完全に同じイベント語彙へ正規化する。フロントの handleEvent は
//    ライブ/再生を区別せず処理できる（新しい表示経路を作らない）。
//  - 何を画面に出すかの正解は CLI の画面。user 行の分類は services/user-entry.js 1か所が持つ。
//  - text / tool_use              → stream_event の content_block_* チェーン
//  - thinking                     → 写さない（CLI の会話画面は考えた跡を残さない。考え中の
//                                   一時表示はライブの stream_event だけが出す）
//  - tool_result                  → type:'user'（フロントの case 'user' が既存の折り畳みへ流す）
//  - image                        → type:'system' の "[image]" マーカー1件（表示はスコープ外）
//  - attachment{queued_command}   → user 行と同じ扱い（ターン中に届いた送信・バックグラウンド完了通知）
//  - user 行の発言／コマンド出力／停止の印 → user_input ／ system 行 ／ system{key:'requestInterrupted'}
//  - system 行                    → 圧縮の区切り・コマンドの記録・警告だけ（CLI が画面に出すもの）
//  - トークン使用量 / ctx% の再構成は行わない（スコープ外）。ターン終端イベント(done/result)も
//    足さない。各ブロックの content_block_stop が finalizeText を呼ぶため描画は閉じる。

const { viewUserEntry } = require('./user-entry')

// content_block（start/delta/stop）1組を out へ push する。
function emitBlock(out, index, contentBlock, delta, timestamp) {
  out.push({ type: 'stream_event', event: { type: 'content_block_start', index, content_block: contentBlock }, timestamp })
  out.push({ type: 'stream_event', event: { type: 'content_block_delta', index, delta }, timestamp })
  out.push({ type: 'stream_event', event: { type: 'content_block_stop', index }, timestamp })
}

function safeStringify(v) {
  try { return JSON.stringify(v == null ? {} : v) } catch { return '{}' }
}

function pushUserView(out, view, ts) {
  for (const item of view.items) {
    if (item.kind === 'prompt') out.push({ type: 'user_input', text: item.text, timestamp: ts })
    else if (item.kind === 'output') { if (item.text) out.push({ type: 'system', text: item.text, timestamp: ts }) }
    else if (item.kind === 'interrupted') out.push({ type: 'system', key: 'requestInterrupted', timestamp: ts })
  }
  for (let i = 0; i < view.images; i++) {
    out.push({ type: 'system', text: '[image]', timestamp: ts })
  }
  if (view.toolResults.length) {
    out.push({ type: 'user', message: { content: view.toolResults }, timestamp: ts })
  }
}

function pushUserEntry(out, entry) {
  pushUserView(out, viewUserEntry(entry), entry.timestamp)
}

// ターン実行中に届いた入力（ユーザーの送信／バックグラウンド処理の完了通知）を CLI は
// user 行ではなく、モデルが読んだ時点で attachment{type:'queued_command'} として書く
// （stdout には一切出ない。実測 2026-09-28）。prompt は user 行の content と同じ形
// （文字列 or text/image ブロック配列）なので user 行と同じ変換に通す。
function pushQueuedCommand(out, entry) {
  const a = entry.attachment
  if (!a || a.type !== 'queued_command' || a.prompt == null) return
  pushUserEntry(out, { message: { content: a.prompt }, timestamp: entry.timestamp })
}

const fmtTokens = n => (typeof n === 'number' && n >= 1000) ? `${Math.round(n / 1000)}K` : (n == null ? '?' : String(n))

// CLI が会話画面に出す system 行だけを写す。
//  - compact_boundary: 圧縮の区切り（CLI: "Conversation compacted"）。前後のトークン数を添える
//  - local_command: 会話内で打ったコマンドとその出力（content は user 行と同じタグ形式）
//  - level が warning/notice/error で本文を持つ行: モデルの切替・安全機構の知らせ等
//  api_error（本文無し・再試行の記録）や info の内部記録は写さない。
function pushSystemEntry(out, entry) {
  const ts = entry.timestamp
  if (entry.subtype === 'compact_boundary') {
    const m = entry.compactMetadata || {}
    // postTokens: 画面の ctx%（✓行）を圧縮後の大きさへ戻すための値（文言には使わない）
    out.push({ type: 'system', key: 'conversationCompacted', params: { from: fmtTokens(m.preTokens), to: fmtTokens(m.postTokens), postTokens: m.postTokens }, timestamp: ts })
    return
  }
  if (typeof entry.content !== 'string' || !entry.content.trim()) return
  if (entry.subtype === 'local_command') {
    pushUserView(out, viewUserEntry({ message: { content: entry.content } }), ts)
  } else if (entry.level === 'warning' || entry.level === 'notice' || entry.level === 'error') {
    out.push({ type: 'system', text: entry.content.trim(), timestamp: ts })
  }
}

function pushAssistantEntry(out, entry) {
  const content = entry.message && entry.message.content
  if (!Array.isArray(content)) return
  const ts = entry.timestamp
  let index = 0

  for (const block of content) {
    if (!block || typeof block !== 'object') continue

    if (block.type === 'text') {
      if (typeof block.text !== 'string' || block.text === '') continue
      emitBlock(out, index++,
        { type: 'text', text: '' },
        { type: 'text_delta', text: block.text }, ts)

    } else if (block.type === 'tool_use') {
      emitBlock(out, index++,
        { type: 'tool_use', id: block.id, name: block.name || 'Tool' },
        { type: 'input_json_delta', partial_json: safeStringify(block.input) }, ts)
    }
  }
}

// entries: ~/.claude/projects/<id>.jsonl のパース済み行（オブジェクト）配列。
// opts.since: ISO文字列。これより後（timestamp > since）のエントリだけを変換する。
function claudeEntriesToEvents(entries, opts = {}) {
  const since = opts.since || null
  const out = []
  if (!Array.isArray(entries)) return out
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue
    if (since && entry.timestamp && entry.timestamp <= since) continue
    if (entry.type === 'user') pushUserEntry(out, entry)
    else if (entry.type === 'assistant') pushAssistantEntry(out, entry)
    else if (entry.type === 'attachment') pushQueuedCommand(out, entry)
    else if (entry.type === 'system') pushSystemEntry(out, entry)
    // それ以外（queue-operation / 他の attachment / atis-latch / last-prompt / ai-title /
    // summary / file-history-snapshot 等）は画面イベントに写さない。
  }
  return out
}

module.exports = { claudeEntriesToEvents }
