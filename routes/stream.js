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

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')

  // 常にログファイルから復元（サービス再起動後もすべての履歴を配信）
  const logEvents = loadLogFile(sessionId)
  logEvents.forEach(ev => res.write(`data: ${JSON.stringify(ev)}\n\n`))
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
