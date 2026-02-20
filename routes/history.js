const express = require('express')
const router = express.Router()
const { listSessions, getSessionMessages } = require('../services/history')

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

// 特定セッションの会話内容
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

module.exports = router
