const fs = require('fs')
const path = require('path')
const { claudeEntriesToEvents } = require('./history-convert')
const { viewUserEntry, titleCandidate } = require('./user-entry')
const { CLAUDE_PROJECTS_DIR, projectDirFor, projectDirs, findTranscript } = require('./claude-dir')

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// セッション一覧取得。project 指定時はそのプロジェクトの会話だけ、省略時は登録済み全プロジェクト。
// CLI は cwd ごとに別ディレクトリへ会話を書くので、プロジェクト＝走査するディレクトリ。
function listSessions(project) {
  const config = require('../config/index')
  let targets
  if (project !== undefined) {
    const cwd = config.projects[project]
    if (!cwd) return []
    targets = [[project, projectDirFor(cwd)]]
  } else {
    targets = Object.entries(config.projects).map(([name, cwd]) => [name, projectDirFor(cwd)])
  }

  const sessions = []
  const seen = new Set()
  for (const [projectName, dir] of targets) {
    let files
    try {
      files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'))
    } catch {
      continue
    }
    for (const file of files) {
      const s = readSessionMeta(dir, file, projectName)
      if (s && !seen.has(s.sessionId)) { seen.add(s.sessionId); sessions.push(s) }
    }
  }

  sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return sessions
}

function readSessionMeta(dir, file, project) {
  const sessionId = file.replace('.jsonl', '')
  if (!UUID_RE.test(sessionId)) return null
  const filePath = path.join(dir, file)
  let stat, title = '', fallback = '', updatedAt = '', msgCount = 0, model = null
  try {
    stat = fs.statSync(filePath)
    updatedAt = stat.mtime.toISOString()
  } catch {
    return null
  }
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(l => l.trim())
    for (const line of lines) {
      try {
        const d = JSON.parse(line)
        if (d.type === 'user') {
          msgCount++
          if (!title) {
            const c = titleCandidate(d)
            if (c && c.title) title = c.title
            else if (c && c.fallback && !fallback) fallback = c.fallback
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
  if (!title) title = fallback || `(${sessionId.slice(0, 8)})`
  return { sessionId, title: title.slice(0, 80), updatedAt, msgCount, model, project }
}

// 特定セッションの会話内容取得（Path Traversal対策付き）
function getSessionMessages(sessionId) {
  if (!UUID_RE.test(sessionId)) {
    throw new Error('invalid sessionId')
  }
  const filePath = findTranscript(sessionId)
  if (!filePath) throw new Error('session not found')

  // セキュリティ: パストラバーサル対策（解決後のパスが登録済みプロジェクトの会話置き場内か確認）
  const resolved = path.resolve(filePath)
  if (!projectDirs().some(d => resolved.startsWith(path.resolve(d) + path.sep))) {
    console.warn('[SECURITY] Path traversal attempt:', { sessionId, resolved })
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
      // user 行の見せ方は会話画面と同じ規則（services/user-entry.js）。発言は user、
      // コマンド出力・停止の印は system（会話画面の灰色の行に当たる）として返す。
      let view = null
      if (d.type === 'user') view = viewUserEntry(d)
      else if (d.type === 'attachment' && d.attachment?.type === 'queued_command' && d.attachment.prompt != null) {
        view = viewUserEntry({ message: { content: d.attachment.prompt } })
      }
      if (view) {
        for (const item of view.items) {
          if (item.kind === 'prompt') messages.push({ role: 'user', text: item.text, timestamp: d.timestamp })
          else if (item.kind === 'output' && item.text) messages.push({ role: 'system', text: item.text, timestamp: d.timestamp })
          else if (item.kind === 'interrupted') messages.push({ role: 'system', key: 'requestInterrupted', timestamp: d.timestamp })
        }
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
// 返り値: weave の結果＋ aBytes（読んだ A のバイト長）＋ aUuids（同じ A の assistant/user の uuid 集合）
function buildConversation(sessionId, { fromA = 0, fromB = 0 } = {}) {
  if (!UUID_RE.test(sessionId)) {
    throw new Error('invalid sessionId')
  }
  const config = require('../config/index')

  let mainRawLines = []
  let pocketRawLines = []
  // A は CLI が書き続けているので、1回だけ読んで最後の改行までを使う（書きかけの末尾行は
  // まだ1行と数えない）。aBytes はその長さで、routes/stream.js の A tail はここから読み始める。
  // 読んだ時点と tail の起点がずれると、間に追記された行が届かず、以降の行番号もずれる
  // （再接続でカーソルが手前に戻り、描画済みの行がもう一度届く）。
  let aBytes = 0
  try {
    const buf = fs.readFileSync(findTranscript(sessionId))
    aBytes = buf.lastIndexOf(0x0a) + 1
    mainRawLines = buf.toString('utf8', 0, aBytes).split('\n')
  } catch {}
  try {
    pocketRawLines = fs.readFileSync(path.join(config.LOGS_DIR, `${sessionId}.jsonl`), 'utf8').split('\n')
  } catch {}

  return { ...weave(mainRawLines, pocketRawLines, { fromA, fromB }), aBytes, aUuids: messageUuids(mainRawLines) }
}

// A の assistant/user 行の uuid 集合（M 再送のアンカー判定用）。
// stdout の assistant/user イベントは A の行と同じ uuid を持つ（実測）。それ以外の
// 行種（queue-operation 等）の uuid は stream_event の uuid と衝突し得るため集めない。
function messageUuids(rawLines) {
  const set = new Set()
  for (const line of rawLines) {
    if (!line.trim()) continue
    try {
      const entry = JSON.parse(line)
      if (entry && (entry.type === 'assistant' || entry.type === 'user') && entry.uuid != null) {
        set.add(entry.uuid)
      }
    } catch {}
  }
  return set
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
//  2. type:'system' かつ subtype!=='init' かつ !text かつ !key → handleEventはinit・text有り・
//     key有り（SYSTEM_LINES の定型行）しか使わない
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
    if (e.type === 'system' && e.subtype !== 'init' && !e.text && !e.key) continue
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
