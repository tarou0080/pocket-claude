const fs = require('fs')
const path = require('path')
const { claudeEntriesToEvents } = require('./history-convert')
const { CLAUDE_PROJECTS_DIR } = require('./claude-dir')

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
    let stat, title = '', updatedAt = '', msgCount = 0, model = null
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
            if (d.message && typeof d.message.model === 'string') {
              model = d.message.model
            }
          }
        } catch {}
      }
    } catch {}
    if (!title) title = `(${sessionId.slice(0, 8)})`
    sessions.push({ sessionId, title: title.slice(0, 80), updatedAt, msgCount, model })
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

// 特定セッションの全イベント取得（履歴再開用）。
//
// v2.15.0: 会話の配信経路を1本に統一（v2.12.2の「自分の会話＝本体jsonl先頭slice＋
// pocketログ再生／外部会話＝本体jsonl直読み」の2本を廃止）。
// 用語:
//  - A ＝ 本体jsonl ~/.claude/projects/<id>.jsonl（非空行番号a、各行にuuid）
//  - B ＝ pocketログ config.LOGS_DIR/<id>.jsonl（非空行番号b、v2.15.0では各行に
//    after: <uuid|null> ＝ 直前のA行のuuid。Bの各行はafterでAの織り込み位置を自ら指定する）
// 実測済み: stdoutのassistant/userイベントはAの行と同じuuidを持つ。
function buildConversation(sessionId, { fromA = 0, fromB = 0 } = {}) {
  if (!UUID_RE.test(sessionId)) {
    throw new Error('invalid sessionId')
  }
  const config = require('../config/index')

  let mainRawLines = []
  let pocketRawLines = []
  try {
    mainRawLines = fs.readFileSync(path.join(CLAUDE_PROJECTS_DIR, `${sessionId}.jsonl`), 'utf8').split('\n')
  } catch {}
  try {
    pocketRawLines = fs.readFileSync(path.join(config.LOGS_DIR, `${sessionId}.jsonl`), 'utf8').split('\n')
  } catch {}

  return weave(mainRawLines, pocketRawLines, { fromA, fromB })
}

// weave: buildConversationの純関数部分。ファイル読みを外に出してテスト可能にしてある
// （mainRawLines/pocketRawLines を直接渡す）。
// 返り値: { events: [{id:'A12'|'B3', ev}], maxA, maxB }
//  - maxA/maxB ＝ 各ファイルの非空行数−1（ファイル無し→−1）
//  - Aの各行は claudeEntriesToEvents([entry]) で変換する。同じ行から出た複数イベントは
//    同じid、各evに uuid: entry.uuid を付与
//  - BのfromB以降をafterで織り込む:
//     * after が A[:fromA] の行（描画済み）を指すもの／after===null|undefined → 先頭にB順
//     * A[fromA:] の行を指すもの → その行のイベント群の直後
//     * Aに無いuuidを指すもの → 末尾にB順
function weave(mainRawLines, pocketRawLines, { fromA = 0, fromB = 0 } = {}) {
  const aLines = (mainRawLines || []).filter(l => l && String(l).trim())
  const bLines = (pocketRawLines || []).filter(l => l && String(l).trim())
  const maxA = aLines.length - 1
  const maxB = bLines.length - 1

  // A側: 非空行ごとにイベント群を作る
  const aGroups = aLines.map((raw, a) => {
    let entry = null
    try { entry = JSON.parse(raw) } catch {}
    const evs = []
    if (entry && typeof entry === 'object') {
      for (const ev of claudeEntriesToEvents([entry])) {
        if (entry.uuid != null) ev.uuid = entry.uuid
        evs.push(ev)
      }
    }
    return { a, id: `A${a}`, evs, uuid: entry ? entry.uuid : undefined }
  })

  const uuidToA = new Map()
  for (const g of aGroups) {
    if (g.uuid != null && !uuidToA.has(g.uuid)) uuidToA.set(g.uuid, g.a)
  }

  // B側: fromB以降をafterで分類する
  const front = []
  const end = []
  const afterA = new Map() // a行番号 → [B行アイテム]
  bLines.forEach((raw, b) => {
    if (b < fromB) return
    let ev = null
    try { ev = JSON.parse(raw) } catch {}
    if (!ev || typeof ev !== 'object') return
    const item = { id: `B${b}`, ev }
    if (ev.after == null) {
      front.push(item)
      return
    }
    const a = uuidToA.get(ev.after)
    if (a === undefined) {
      end.push(item)
      return
    }
    if (a < fromA) {
      front.push(item)
      return
    }
    if (!afterA.has(a)) afterA.set(a, [])
    afterA.get(a).push(item)
  })

  const events = []
  for (const item of front) events.push(item)
  for (const g of aGroups) {
    if (g.a < fromA) continue
    for (const ev of g.evs) events.push({ id: g.id, ev })
    const group = afterA.get(g.a)
    if (group) for (const item of group) events.push(item)
  }
  for (const item of end) events.push(item)

  return { events, maxA, maxB }
}

function getSessionEvents(sessionId) {
  return buildConversation(sessionId).events.map(e => e.ev)
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

module.exports = { listSessions, getSessionMessages, getSessionEvents, buildConversation, weave, slimEventsForReplay, UUID_RE, CLAUDE_PROJECTS_DIR }
