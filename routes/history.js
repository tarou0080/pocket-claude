const express = require('express')
const zlib = require('zlib')
const router = express.Router()
const { listSessions, getSessionMessages, buildConversation, slimEventsForReplay } = require('../services/history')

// セッション一覧。?project=<name> でそのプロジェクトの会話だけ（省略時は全プロジェクト）
router.get('/', (req, res) => {
  try {
    const project = typeof req.query.project === 'string' ? req.query.project : undefined
    const sessions = listSessions(project)
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
    const conv = buildConversation(sessionId)
    const events = slimEventsForReplay(conv.events.map(e => e.ev))
    const body = JSON.stringify(events)
    const acceptEncoding = req.headers['accept-encoding'] || ''
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    // X-Cursor-A / X-Cursor-B: 次にクライアントが要求すべき境界（maxA+1／maxB+1＝
    // 「まだ受け取っていない行番号」の始まり）。旧ヘッダ（本体jsonl非空行数境界）は撤去。
    res.setHeader('X-Cursor-A', String(conv.maxA + 1))
    res.setHeader('X-Cursor-B', String(conv.maxB + 1))
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
