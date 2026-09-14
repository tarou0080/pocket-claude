const fs = require('fs')
const path = require('path')
const { claudeEntriesToEvents } = require('./history-convert')
const { resolveCanonicalId } = require('./sessions')

const homeDir = process.env.HOME || path.join('/home', process.env.USER || 'user')
const homeDirNormalized = homeDir.replace(/\//g, '-')
const CLAUDE_PROJECTS_DIR = path.join(homeDir, '.claude', 'projects', homeDirNormalized)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// セッション一覧取得
function listSessions() {
  let files
  try {
    files = fs.readdirSync(CLAUDE_PROJECTS_DIR).filter(f => f.endsWith('.jsonl'))
  } catch {
    return []
  }

  const sessions = []
  for (const file of files) {
    const sessionId = file.replace('.jsonl', '')
    if (!UUID_RE.test(sessionId)) continue
    const filePath = path.join(CLAUDE_PROJECTS_DIR, file)
    let stat, title = '', updatedAt = '', msgCount = 0
    try {
      stat = fs.statSync(filePath)
      updatedAt = stat.mtime.toISOString()
    } catch {
      continue
    }
    try {
      const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(l => l.trim())
      for (const line of lines) {
        try {
          const d = JSON.parse(line)
          if (d.type === 'user') {
            msgCount++
            if (!title) {
              const content = d.message?.content
              if (typeof content === 'string') title = content
              else if (Array.isArray(content)) {
                const textBlock = content.find(c => c.type === 'text')
                if (textBlock) title = textBlock.text
              }
            }
          } else if (d.type === 'assistant') {
            msgCount++
          }
        } catch {}
      }
    } catch {}
    if (!title) title = `(${sessionId.slice(0, 8)})`
    sessions.push({ sessionId, title: title.slice(0, 80), updatedAt, msgCount })
  }

  sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return sessions
}

// 特定セッションの会話内容取得（Path Traversal対策付き）
function getSessionMessages(sessionId) {
  if (!UUID_RE.test(sessionId)) {
    throw new Error('invalid sessionId')
  }
  // 旧pocket IDのタブから開かれても正規ID（Claude session ID）の会話を返す
  sessionId = resolveCanonicalId(sessionId)

  // セキュリティ: CLAUDE_PROJECTS_DIRの存在確認
  if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) {
    console.error('[SECURITY] CLAUDE_PROJECTS_DIR does not exist:', CLAUDE_PROJECTS_DIR)
    throw new Error('history directory not found')
  }

  const filePath = path.join(CLAUDE_PROJECTS_DIR, `${sessionId}.jsonl`)

  // セキュリティ: パストラバーサル対策（解決後のパスがディレクトリ内か確認）
  const resolved = path.resolve(filePath)
  const allowedDir = path.resolve(CLAUDE_PROJECTS_DIR)
  if (!resolved.startsWith(allowedDir + path.sep)) {
    console.warn('[SECURITY] Path traversal attempt:', { sessionId, resolved, allowedDir })
    throw new Error('invalid path')
  }

  let lines
  try {
    lines = fs.readFileSync(resolved, 'utf8').split('\n').filter(l => l.trim())
  } catch (err) {
    console.error('[SECURITY] Failed to read history file:', { sessionId, error: err.message })
    throw new Error('session not found')
  }

  const messages = []
  for (const line of lines) {
    try {
      const d = JSON.parse(line)
      if (d.type === 'user') {
        const content = d.message?.content
        let text = ''
        if (typeof content === 'string') text = content
        else if (Array.isArray(content)) {
          text = content.filter(c => c.type === 'text').map(c => c.text).join('\n')
        }
        if (text.trim()) messages.push({ role: 'user', text, timestamp: d.timestamp })
      } else if (d.type === 'assistant') {
        const content = d.message?.content
        if (!Array.isArray(content)) continue
        const text = content.filter(c => c.type === 'text').map(c => c.text).join('\n')
        if (text.trim()) messages.push({ role: 'assistant', text, timestamp: d.timestamp })
      }
    } catch {}
  }

  return messages
}

// 特定セッションの全イベント取得（履歴再開用）。
//
// v2.12.0 でID統一済み: pocket session ID === Claude session ID。逆引き（claudeSessionId
// フィールド・sessions/全走査）は撤去した。旧pocket IDから開かれた場合は resolveCanonicalId が
// 転送スタブを1段辿って正規IDへ寄せる。
// v2.12.2: pocketログの寿命＝claudeプロセスの寿命になり、進行中の会話は常に
// pocketログ側にある。境界はテキスト照合（cutCurrentTurn、要約等でズレ得た）ではなく
// pocketログ先頭の log_start 行が持つ mainLines（このpocketログが積まれ始めた時点の
// 本体jsonl非空行数）で決める。本体jsonlは非空行数で mainLines 件だけ読み、残りは
// SSE側（routes/stream.js の event:history、pocketログのhistory全量再生）に任せる。
function getSessionEvents(sessionId) {
  if (!UUID_RE.test(sessionId)) {
    throw new Error('invalid sessionId')
  }
  sessionId = resolveCanonicalId(sessionId)

  const config = require('../config/index')

  const jsonlPath = path.join(CLAUDE_PROJECTS_DIR, `${sessionId}.jsonl`)
  const pocketLogPath = path.join(config.LOGS_DIR, `${sessionId}.jsonl`)

  let mainRawLines
  try {
    mainRawLines = fs.readFileSync(jsonlPath, 'utf8').split('\n').filter(l => l.trim())
  } catch {
    mainRawLines = []
  }

  let pocketFirstLineText
  try {
    pocketFirstLineText = fs.readFileSync(pocketLogPath, 'utf8').split('\n').find(l => l.trim())
  } catch {
    pocketFirstLineText = undefined
  }

  // pocketログが無い → 本体jsonl全部（切り落とし不要）
  if (pocketFirstLineText === undefined) {
    return claudeEntriesToEvents(mainRawLines.map(l => {
      try { return JSON.parse(l) } catch { return null }
    }).filter(Boolean))
  }

  // pocketログはあるが先頭行が log_start でない（v2.12.2デプロイ以前からの旧形式ファイル）
  // → mainLines=0 扱い。本体jsonl側は何も含めず、続きは丸ごとSSEのpocketログ再生に委ねる。
  let mainLines = 0
  try {
    const firstLine = JSON.parse(pocketFirstLineText)
    if (firstLine && firstLine.type === 'log_start' && typeof firstLine.mainLines === 'number') {
      mainLines = firstLine.mainLines
    }
  } catch {}

  const slice = mainRawLines.slice(0, mainLines).map(l => {
    try { return JSON.parse(l) } catch { return null }
  }).filter(Boolean)
  return claudeEntriesToEvents(slice)
}

// 履歴再生専用にイベント列を整理する純粋関数。
// クライアントの描画結果（handleEvent の出力）が1バイトも変わらないことが条件。
// 入力配列・要素を破壊的に書き換えない（getSessionEvents() の返り値をそのまま渡される前提）。
//
// 除去規則（4つだけ）:
//  1. type:'assistant' かつ error!=='rate_limit' → handleEventのcase 'assistant'は
//     rate_limit以外何もしない（本文はstream_eventのtext_deltaで描画済みの重複）
//  2. type:'system' かつ subtype!=='init' かつ !text → handleEventはinitかtext有りしか使わない
//  3. type:'stream_event' かつ event.delta.type が signature_delta/thinking_delta →
//     content_block_deltaハンドラはtext_delta/input_json_deltaしか見ていない
//  4. type:'user' の tool_use_result フィールドを除去 → resolveToolContent は
//     第2引数(toolUseResult)を本体で参照しない未使用引数
//
// さらに、直前の出力要素が同じ delta.type（text_delta/input_json_delta）の
// content_block_delta なら、新規イベントを足さず直前へ連結する（text/partial_jsonを結合）。
// 他のイベント種別（content_block_start/stopを含む）が来たら合体は打ち切られる。
function slimEventsForReplay(events) {
  const out = []
  for (const e of events) {
    if (e.type === 'assistant' && e.error !== 'rate_limit') continue
    if (e.type === 'system' && e.subtype !== 'init' && !e.text) continue
    if (e.type === 'stream_event') {
      const deltaType = e.event && e.event.delta && e.event.delta.type
      if (deltaType === 'signature_delta' || deltaType === 'thinking_delta') continue
    }

    let ev = e
    if (e.type === 'user' && Object.prototype.hasOwnProperty.call(e, 'tool_use_result')) {
      const rest = Object.assign({}, e)
      delete rest.tool_use_result
      ev = rest
    }

    if (ev.type === 'stream_event' && ev.event && ev.event.type === 'content_block_delta') {
      const deltaType = ev.event.delta && ev.event.delta.type
      if (deltaType === 'text_delta' || deltaType === 'input_json_delta') {
        const prev = out[out.length - 1]
        if (
          prev &&
          prev.type === 'stream_event' &&
          prev.event &&
          prev.event.type === 'content_block_delta' &&
          prev.event.delta &&
          prev.event.delta.type === deltaType
        ) {
          const mergedDelta = Object.assign({}, prev.event.delta)
          if (deltaType === 'text_delta') {
            mergedDelta.text = (mergedDelta.text || '') + (ev.event.delta.text || '')
          } else {
            mergedDelta.partial_json = (mergedDelta.partial_json || '') + (ev.event.delta.partial_json || '')
          }
          const mergedEvent = Object.assign({}, prev.event, { delta: mergedDelta })
          const mergedEv = Object.assign({}, prev, { event: mergedEvent })
          out[out.length - 1] = mergedEv
          continue
        }
      }
    }

    out.push(ev)
  }
  return out
}

module.exports = { listSessions, getSessionMessages, getSessionEvents, slimEventsForReplay, UUID_RE, CLAUDE_PROJECTS_DIR }
