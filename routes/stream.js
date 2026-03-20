const express = require('express')
const router = express.Router()
const { getState, loadLogFile, registerSSEClient, unregisterSSEClient } = require('../services/stream')

// SSEエンドポイント
router.get('/', (req, res) => {
  const sessionId = req.query.session
  if (!sessionId) {
    res.status(400).end()
    return
  }

  const s = getState(sessionId)
  const skipHistory = req.query.skipHistory === '1'

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')

  // skipHistory=1の場合は履歴をスキップ（完了済みセッションの再接続時に使用）
  if (!skipHistory) {
    const logEvents = loadLogFile(sessionId)
    logEvents.forEach(ev => res.write(`data: ${JSON.stringify(ev)}\n\n`))
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
