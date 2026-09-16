const express = require('express')
const zlib = require('zlib')
const fs = require('fs')
const path = require('path')
const router = express.Router()
const { listSessions, getSessionMessages, getSessionEvents, slimEventsForReplay, CLAUDE_PROJECTS_DIR } = require('../services/history')

// セッション一覧
router.get('/', (_req, res) => {
  try {
    const sessions = listSessions()
    res.json(sessions)
  } catch (err) {
    console.error('[ERROR] Failed to list sessions:', err)
    res.status(500).json({ error: 'failed to list sessions' })
  }
})

// 特定セッションの会話内容（テキストのみ）
router.get('/:sessionId', (req, res) => {
  const { sessionId } = req.params
  try {
    const messages = getSessionMessages(sessionId)
    res.json(messages)
  } catch (err) {
    if (err.message === 'invalid sessionId' || err.message === 'invalid path') {
      return res.status(400).json({ error: err.message })
    }
    if (err.message === 'session not found' || err.message === 'history directory not found') {
      return res.status(404).json({ error: err.message })
    }
    console.error('[ERROR] Failed to get session messages:', err)
    res.status(500).json({ error: 'failed to get session messages' })
  }
})

// 特定セッションの全イベント（履歴再開用）
// 最大4.6MB程度になりうるJSONのため、クライアントがgzipに対応していれば
// Node標準のzlibで圧縮して返す（新規依存は追加しない＝expressのみの方針を維持）。
router.get('/:sessionId/events', (req, res) => {
  const { sessionId } = req.params
  try {
    const events = slimEventsForReplay(getSessionEvents(sessionId))
    const body = JSON.stringify(events)
    const acceptEncoding = req.headers['accept-encoding'] || ''
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    // X-Main-Lines: 本体jsonlから変換した非空行数。外部会話は SSE で history-meta.maxLine
    // として使われ、既に読み込んだ分を飛ばすための基準になる。
    try {
      const raw = fs.readFileSync(path.join(CLAUDE_PROJECTS_DIR, `${sessionId}.jsonl`), 'utf8')
      const mainLines = raw.split('\n').filter(l => l.trim()).length
      res.setHeader('X-Main-Lines', String(mainLines))
    } catch {}
    // X-Uncompressed-Length: 展開後（実際にクライアントが受信・デコードする）バイト数。
    // Content-Length は gzip 時は圧縮後バイト数になるため、進捗計算の分母には使えない
    // （クライアントの reader は展開後バイト数を返すため単位が食い違う）。
    res.setHeader('X-Uncompressed-Length', Buffer.byteLength(body))
    if (acceptEncoding.includes('gzip')) {
      const gz = zlib.gzipSync(Buffer.from(body, 'utf8'))
      res.setHeader('Content-Encoding', 'gzip')
      res.setHeader('Content-Length', gz.length)
      res.end(gz)
    } else {
      res.setHeader('Content-Length', Buffer.byteLength(body))
      res.end(body)
    }
  } catch (err) {
    if (err.message === 'invalid sessionId') {
      return res.status(400).json({ error: err.message })
    }
    console.error('[ERROR] Failed to get session events:', err)
    res.status(500).json({ error: 'failed to get session events' })
  }
})

module.exports = router
