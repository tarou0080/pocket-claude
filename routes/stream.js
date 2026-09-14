const express = require('express')
const router = express.Router()
const { getState, loadLogFile, registerSSEClient, unregisterSSEClient, getLineBase, classifyCursor, EPOCH } = require('../services/stream')
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
  // epoch: クライアントが最後に見たサーバー世代。Last-Event-ID 経路（EventSource自動再接続）
  // では epoch を読まない＝未指定扱い（fromLine の範囲判定のみで reset 可否を決める）。
  let reqEpoch
  if (!req.query.fromLine && lastEventIdHeader) {
    const parsed = parseInt(lastEventIdHeader, 10)
    if (!isNaN(parsed)) fromLine = parsed + 1
  } else {
    const parsedEpoch = parseInt(req.query.epoch, 10)
    reqEpoch = isNaN(parsedEpoch) ? undefined : parsedEpoch
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')

  // ログ再生は名前付きイベント(event: history)で送り、ライブのbroadcast（無名イベント）と
  // プロトコルレベルで区別する。クライアントは history を isLive=false で処理する。
  // appendFileSync 化により、loadLogFile(readFileSync) と registerSSEClient の間に
  // 新規行が割り込むことはなく、取りこぼし/重複ゼロを保証する（同期ブロック内）。
  // base: discardPocketLog（プロセス終了時）でファイルは消えても行番号空間は
  // 巻き戻らないため、現在のファイルの行0が全体で何行目かは lineCounts 側から引く。
  const all = loadLogFile(sessionId)
  const base = getLineBase(sessionId, all.length)
  const maxLine = base + all.length - 1

  // カーソルの世代管理（v2.12.2）: サーバー再起動（epoch不一致）／pocketログ有限化で
  // 既に失われた行（fromLine<base）／再起動後の行番号巻き戻りで追い越された行
  // （fromLine>maxLine+1）のいずれかなら reset。history 行は1本も書かず、クライアントに
  // 「そのカーソルは無効」と伝えて丸ごと取り直させる（流してから消させると描画→消去の
  // ちらつきになるため）。
  const status = classifyCursor({ epoch: reqEpoch, fromLine }, { epoch: EPOCH, base, maxLine })
  if (status === 'reset') {
    res.write(`event: history-meta\ndata: ${JSON.stringify({ epoch: EPOCH, base, maxLine, reset: true })}\n\n`)
  } else {
    all.forEach((ev, i) => {
      const id = base + i
      if (id >= fromLine) res.write(`event: history\nid: ${id}\ndata: ${JSON.stringify(ev)}\n\n`)
    })
    // キャッシュlastLineがサーバー実行数を超えていない（stale）かチェックするためのメタ情報
    res.write(`event: history-meta\ndata: ${JSON.stringify({ epoch: EPOCH, base, maxLine })}\n\n`)
  }
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
