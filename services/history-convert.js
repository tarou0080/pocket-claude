// Claude Code の会話jsonl（~/.claude/projects/<id>.jsonl のパース済み行配列）を
// pocket-claude の画面イベント列へ変換する。
//
// 方針（設計の背景「特別扱いを増やさない」の踏襲）:
//  - 出力はライブ配信(SSE)と完全に同じイベント語彙へ正規化する。フロントの handleEvent は
//    ライブ/再生を区別せず処理できる（新しい表示経路を作らない）。
//  - text / thinking / tool_use  → stream_event の content_block_* チェーン
//  - tool_result                 → type:'user'（フロントの case 'user' が既存の折り畳みへ流す）
//  - image                       → type:'system' の "[image]" マーカー1件（表示はスコープ外）
//  - トークン使用量 / ctx% の再構成は行わない（スコープ外）。ターン終端イベント(done/result)も
//    足さない。各ブロックの content_block_stop が finalizeText を呼ぶため描画は閉じる。

// content_block（start/delta/stop）1組を out へ push する。
function emitBlock(out, index, contentBlock, delta, timestamp) {
  out.push({ type: 'stream_event', event: { type: 'content_block_start', index, content_block: contentBlock }, timestamp })
  out.push({ type: 'stream_event', event: { type: 'content_block_delta', index, delta }, timestamp })
  out.push({ type: 'stream_event', event: { type: 'content_block_stop', index }, timestamp })
}

function safeStringify(v) {
  try { return JSON.stringify(v == null ? {} : v) } catch { return '{}' }
}

function pushUserEntry(out, entry) {
  const content = entry.message && entry.message.content
  const ts = entry.timestamp

  if (typeof content === 'string') {
    // CLIの制御系メッセージ（<local-command-stdout>...set_model 実行結果 等）は
    // ライブでは type:'user' の文字列 content として届き、フロントが system 行へ落とす。
    if (/^\s*<local-command-stdout>/.test(content)) {
      out.push({ type: 'user', message: { content }, timestamp: ts })
    } else if (content.trim()) {
      out.push({ type: 'user_input', text: content, timestamp: ts })
    }
    return
  }
  if (!Array.isArray(content)) return

  const texts = content
    .filter(b => b && b.type === 'text' && typeof b.text === 'string')
    .map(b => b.text)
  const joined = texts.join('\n')
  if (joined.trim()) out.push({ type: 'user_input', text: joined, timestamp: ts })

  const imageCount = content.filter(b => b && b.type === 'image').length
  for (let i = 0; i < imageCount; i++) {
    out.push({ type: 'system', text: '[image]', timestamp: ts })
  }

  const toolResults = content.filter(b => b && b.type === 'tool_result')
  if (toolResults.length) {
    out.push({ type: 'user', message: { content: toolResults }, timestamp: ts })
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

    } else if (block.type === 'thinking') {
      // thinking 本文（thinking_delta）は slimEventsForReplay が再生前に落とす。
      // フロントは start で "[thinking...]"、stop で "[thinking done]" を出すだけなので
      // 中身が空（signatureのみ）でもブロックの存在は伝わる。
      emitBlock(out, index++,
        { type: 'thinking' },
        { type: 'thinking_delta', thinking: typeof block.thinking === 'string' ? block.thinking : '' }, ts)

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
    // それ以外（queue-operation / attachment / atis-latch / last-prompt / ai-title /
    // summary / system / file-history-snapshot 等）は画面イベントに写さない。
  }
  return out
}

module.exports = { claudeEntriesToEvents }
