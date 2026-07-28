const fs = require('fs')
const path = require('path')

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

// 特定セッションの全イベント取得（履歴再開用）
function getSessionEvents(sessionId) {
  if (!UUID_RE.test(sessionId)) {
    throw new Error('invalid sessionId')
  }

  const path = require('path')
  const config = require('../config/index')
  const sessionsDir = path.join(__dirname, '..', 'sessions')

  function readLogFile(logPath) {
    try {
      return fs.readFileSync(logPath, 'utf8').split('\n').filter(l => l.trim()).map(l => {
        try { return JSON.parse(l) } catch { return null }
      }).filter(Boolean)
    } catch {
      return []
    }
  }

  // sessions/ を逆引き: claudeSessionId === sessionId となる pocketSessionId を探す
  // self-mapping（pocketSessionId === sessionId）は除外し、オリジナルのログを探す
  let originalPocketId = null
  try {
    const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'))
    for (const file of files) {
      const pocketId = file.replace('.json', '')
      if (pocketId === sessionId) continue  // self-mapping除外
      try {
        const data = JSON.parse(fs.readFileSync(path.join(sessionsDir, file), 'utf8'))
        if (data.claudeSessionId === sessionId) {
          originalPocketId = pocketId
          break
        }
      } catch {}
    }
  } catch {}

  // オリジナルのログ（履歴復帰前）＋直接ログ（履歴復帰後の新会話）をマージ
  const originalEvents = originalPocketId
    ? readLogFile(path.join(config.LOGS_DIR, `${originalPocketId}.jsonl`))
    : []
  const directEvents = readLogFile(path.join(config.LOGS_DIR, `${sessionId}.jsonl`))

  const pocketEvents = [...originalEvents, ...directEvents]

  // pocket-claudeログの最後のdoneイベントのtimestampを取得
  let lastDoneTs = null
  for (let i = pocketEvents.length - 1; i >= 0; i--) {
    if (pocketEvents[i].type === 'done' && pocketEvents[i].timestamp) {
      lastDoneTs = pocketEvents[i].timestamp
      break
    }
  }

  // sessions/<sessionId>.json から claudeSessionId を取得
  let claudeSessionId = sessionId
  try {
    const data = JSON.parse(fs.readFileSync(path.join(sessionsDir, `${sessionId}.json`), 'utf8'))
    claudeSessionId = data.claudeSessionId || sessionId
  } catch {}

  // self-mappingかつpocket-claudeログが空の場合（historyからresumeした未送信セッション）：
  // ~/.claude/projects/ の全エントリをイベント変換して返す
  if (pocketEvents.length === 0 && claudeSessionId === sessionId) {
    const jsonlPath = path.join(CLAUDE_PROJECTS_DIR, `${claudeSessionId}.jsonl`)
    const claudeLines = readLogFile(jsonlPath)
    const events = []
    for (const entry of claudeLines) {
      if (entry.type === 'user') {
        const content = entry.message?.content
        if (!content) continue
        const textBlock = Array.isArray(content)
          ? content.find(c => c.type === 'text')
          : (typeof content === 'string' ? { text: content } : null)
        if (!textBlock?.text?.trim()) continue
        events.push({ type: 'user_input', text: textBlock.text, timestamp: entry.timestamp })
      } else if (entry.type === 'assistant') {
        const content = entry.message?.content
        if (!Array.isArray(content)) continue
        const texts = content.filter(c => c.type === 'text').map(c => c.text)
        if (!texts.length) continue
        const fullText = texts.join('')
        events.push({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } })
        events.push({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: fullText } } })
        events.push({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } })
        events.push({ type: 'done', exitCode: 0, timestamp: entry.timestamp })
      }
    }
    return events
  }

  // pocket-claudeログ以降にVS Code等で追加された会話を~/.claude/projects/から補完
  // lastDoneTsがない場合はpocket-claudeで一度も送信していないセッションなので補完しない
  if (lastDoneTs) {
    const jsonlPath = path.join(CLAUDE_PROJECTS_DIR, `${claudeSessionId}.jsonl`)
    const claudeLines = readLogFile(jsonlPath)

    // lastDoneTs以降のuser/assistantエントリをpocket-claudeイベント形式に変換
    const extraEvents = []
    for (const entry of claudeLines) {
      if (!entry.timestamp || entry.timestamp <= lastDoneTs) continue

      if (entry.type === 'user') {
        const content = entry.message?.content
        if (!content) continue
        const textBlock = Array.isArray(content)
          ? content.find(c => c.type === 'text')
          : (typeof content === 'string' ? { text: content } : null)
        if (!textBlock?.text?.trim()) continue
        extraEvents.push({ type: 'user_input', text: textBlock.text, timestamp: entry.timestamp })

      } else if (entry.type === 'assistant') {
        const content = entry.message?.content
        if (!Array.isArray(content)) continue
        const texts = content.filter(c => c.type === 'text').map(c => c.text)
        if (!texts.length) continue
        const fullText = texts.join('')
        // stream_eventチェーンに展開してhandleEventが処理できる形式に変換
        extraEvents.push({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } })
        extraEvents.push({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: fullText } } })
        extraEvents.push({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } })
        extraEvents.push({ type: 'done', exitCode: 0, timestamp: entry.timestamp })
      }
    }

    if (extraEvents.length > 0) {
      return [...pocketEvents, ...extraEvents]
    }
  }

  return pocketEvents
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
