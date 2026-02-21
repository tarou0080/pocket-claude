const express = require('express')
const router = express.Router()
const { getState, loadLogFile, registerSSEClient, unregisterSSEClient } = require('../services/stream')

// SSEエンドポイント
router.get('/', (req, res) => {
  const tabId = req.query.tab
  if (!tabId) {
    res.status(400).end()
    return
  }

  const s = getState(tabId)

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')

  // 常にログファイルから復元（サービス再起動後もすべての履歴を配信）
  const logEvents = loadLogFile(tabId)
  logEvents.forEach(ev => res.write(`data: ${JSON.stringify(ev)}\n\n`))
  registerSSEClient(tabId, res)

  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n')
    } catch {}
  }, 20000)

  req.on('close', () => {
    clearInterval(heartbeat)
    unregisterSSEClient(tabId, res)
  })
})

module.exports = router
