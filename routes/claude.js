const express = require('express')
const fs = require('fs')
const path = require('path')
const router = express.Router()
const { startClaude, stopClaude, stopPending, injectPrompt, gitPull } = require('../services/spawner')
const { getState, broadcast, logFile } = require('../services/stream')
const config = require('../config/index')

const sessionsDir = path.join(__dirname, '..', 'sessions')

function getClaudeSessionId(sessionId) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(sessionsDir, `${sessionId}.json`), 'utf8'))
    return data.claudeSessionId || null
  } catch { return null }
}

// プロジェクト一覧
router.get('/projects', (_req, res) => {
  res.json(Object.keys(config.projects))
})

// 状態確認
router.get('/status', (req, res) => {
  const sessionId = req.query.session
  if (!sessionId) return res.status(400).json({ error: 'session required' })
  const s = getState(sessionId)
  res.json({ running: s.process !== null, pending: s.pendingPrompt || null })
})

// プロンプト送信
router.post('/send', async (req, res) => {
  const { prompt, sessionId, project, model } = req.body
  if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'prompt required' })

  const { randomUUID } = require('crypto')
  const actualSessionId = sessionId || randomUUID()
  const claudeSessionId = sessionId ? getClaudeSessionId(actualSessionId) : null
  const actualProject = project || Object.keys(config.projects)[0]

  const s = getState(actualSessionId)

  if (s.process) {
    broadcast(actualSessionId, { type: 'user_input', text: prompt })
    const injected = injectPrompt(actualSessionId, prompt)
    if (!injected) {
      s.pendingPrompt = prompt
      s.pendingModel = model || null
    }
    return res.json({ ok: true, sessionId: actualSessionId, injected })
  }

  // git pull
  const projectDir = config.projects[actualProject]
  if (projectDir) {
    const pulled = await gitPull(projectDir)
    if (pulled) broadcast(actualSessionId, { type: 'system', text: `git pull: ${pulled}` })
  }

  broadcast(actualSessionId, { type: 'user_input', text: prompt })
  startClaude(actualSessionId, prompt, model, actualProject, claudeSessionId)
  res.json({ ok: true, sessionId: actualSessionId, queued: false })
})

// 停止
router.post('/stop', (req, res) => {
  const sessionId = req.body.session
  if (!sessionId) return res.status(400).json({ error: 'session required' })
  const stopped = stopClaude(sessionId)
  if (!stopped) return res.status(409).json({ error: 'not running' })
  res.json({ ok: true })
})

// ペンディングキャンセル
router.post('/stop-pending', (req, res) => {
  const sessionId = req.body.session
  if (!sessionId) return res.status(400).json({ error: 'session required' })
  stopPending(sessionId)
  res.json({ ok: true })
})

// セッション登録（履歴再開用）
router.post('/register-session', (req, res) => {
  const { pocketSessionId, claudeSessionId } = req.body
  if (!pocketSessionId || !claudeSessionId) return res.status(400).json({ error: 'pocketSessionId and claudeSessionId required' })
  try {
    fs.mkdirSync(sessionsDir, { recursive: true })
    fs.writeFileSync(path.join(sessionsDir, `${pocketSessionId}.json`), JSON.stringify({ claudeSessionId }))
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// セッションリセット
router.post('/reset', (req, res) => {
  const sessionId = req.body.session
  if (!sessionId) return res.status(400).json({ error: 'session required' })
  const s = getState(sessionId)
  if (s.process) return res.status(409).json({ error: 'Claude is running.' })
  s.buffer = []
  fs.unlink(logFile(sessionId), () => {})
  fs.unlink(path.join(sessionsDir, `${sessionId}.json`), () => {})
  res.json({ ok: true, sessionId })
})

module.exports = router
