const express = require('express')
const router = express.Router()
const { getState, loadLogFile, registerSSEClient, unregisterSSEClient, getLineBase } = require('../services/stream')
const { UUID_RE } = require('../services/history')
const { resolveCanonicalId } = require('../services/sessions')

// SSEエンドポイント
router.get('/', (req, res) => {
  const raw = req.query.session
  if (!raw) {
    res.status(400).end()
    return
  }
  if (!UUID_RE.test(raw)) {
    res.status(400).json({ error: 'invalid sessionId' })
    return
  }
  // 旧pocket IDのタブが張った EventSource でも、正規ID（Claude session ID）の
  // ライブログ／状態へ寄せる。逆引きは呼ばない（転送スタブ1件のO(1)読み）。
  const sessionId = resolveCanonicalId(raw)

  getState(sessionId)

  // fromLine: クライアントが最後に受信した行の次から送る（増分同期）。
  // Last-Event-ID ヘッダがある場合（EventSource のネイティブ自動再接続）は +1 して利用する。
  let fromLine = Math.max(0, parseInt(req.query.fromLine, 10) || 0)
  const lastEventIdHeader = req.headers['last-event-id']
  if (!req.query.fromLine && lastEventIdHeader) {
    const parsed = parseInt(lastEventIdHeader, 10)
    if (!isNaN(parsed)) fromLine = parsed + 1
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')

  // ログ再生は名前付きイベント(event: history)で送り、ライブのbroadcast（無名イベント）と
  // プロトコルレベルで区別する。クライアントは history を isLive=false で処理する。
  // appendFileSync 化により、loadLogFile(readFileSync) と registerSSEClient の間に
  // 新規行が割り込むことはなく、取りこぼし/重複ゼロを保証する（同期ブロック内）。
  // base: discardPocketLog（v2.12.1、ターン跨ぎ）でファイルは消えても行番号空間は
  // 巻き戻らないため、現在のファイルの行0が全体で何行目かは lineCounts 側から引く。
  const all = loadLogFile(sessionId)
  const base = getLineBase(sessionId, all.length)
  all.forEach((ev, i) => {
    const id = base + i
    if (id >= fromLine) res.write(`event: history\nid: ${id}\ndata: ${JSON.stringify(ev)}\n\n`)
  })
  // キャッシュlastLineがサーバー実行数を超えていない（stale）かチェックするためのメタ情報
  res.write(`event: history-meta\ndata: ${JSON.stringify({ maxLine: base + all.length - 1 })}\n\n`)
  registerSSEClient(sessionId, res)

  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n')
    } catch {}
  }, 20000)

  req.on('close', () => {
    clearInterval(heartbeat)
    unregisterSSEClient(sessionId, res)
  })
})

module.exports = router
