const express = require('express')
const fs = require('fs')
const path = require('path')
const router = express.Router()
const { startClaude, stopClaude, stopPending, removePending, updatePending, injectPrompt, respondToAsk, gitPull } = require('../services/spawner')
const { getState, broadcast, logFile } = require('../services/stream')
const { scheduleResume, cancelResume, getSchedule } = require('../services/scheduler')
const { getClaudeSessionId } = require('../services/sessions')
const config = require('../config/index')

const sessionsDir = path.join(__dirname, '..', 'sessions')

// プロジェクト一覧
router.get('/projects', (_req, res) => {
  res.json(Object.keys(config.projects))
})

// 状態確認
router.get('/status', (req, res) => {
  const sessionId = req.query.session
  if (!sessionId) return res.status(400).json({ error: 'session required' })
  const s = getState(sessionId)
  res.json({ running: s.turning, queue: (s.pendingQueue || []).map(q => ({ prompt: q.prompt })) })
})

// プロンプト送信
router.post('/send', async (req, res) => {
  const { prompt, sessionId, project, model, effort, thinking, images } = req.body
  if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'prompt required' })

  // images: [{ mediaType, data }] の配列（base64）
  const imageData = (Array.isArray(images) && images.length > 0) ? images : null

  const { randomUUID } = require('crypto')
  const actualSessionId = sessionId || randomUUID()
  const claudeSessionId = sessionId ? getClaudeSessionId(actualSessionId) : null
  const actualProject = project || Object.keys(config.projects)[0]

  const s = getState(actualSessionId)

  if (s.process) {
    // プロセス稼働中 → 直接stdinに注入（割り込み送信）
    const injected = injectPrompt(actualSessionId, prompt, imageData)
    if (!injected) {
      if (!s.pendingQueue) s.pendingQueue = []
      s.pendingQueue.push({
        prompt,
        model: model || null,
        effort: effort || null,
        thinking: thinking !== undefined ? thinking : null,
        imageData,
      })
      broadcast(actualSessionId, { type: 'queue_update', queue: s.pendingQueue.map(q => ({ prompt: q.prompt })) })
    }
    return res.json({ ok: true, sessionId: actualSessionId, injected, queued: !injected, queueLength: s.pendingQueue ? s.pendingQueue.length : 0 })
  }

  // git pull
  const projectDir = config.projects[actualProject]
  if (projectDir) {
    const pulled = await gitPull(projectDir)
    if (pulled) broadcast(actualSessionId, { type: 'system', text: `git pull: ${pulled}` })
  }

  broadcast(actualSessionId, { type: 'user_input', text: prompt })
  startClaude(actualSessionId, prompt, model, actualProject, claudeSessionId, effort || null, thinking !== undefined ? thinking : null, imageData)
  res.json({ ok: true, sessionId: actualSessionId, queued: false })
})

// AskUserQuestion への応答
router.post('/respond', (req, res) => {
  const { session, answer } = req.body
  if (!session || !answer || !answer.trim()) return res.status(400).json({ error: 'session and answer required' })
  const ok = respondToAsk(session, answer.trim())
  if (!ok) return res.status(409).json({ error: 'no active process or ask' })
  res.json({ ok: true })
})

// 停止
router.post('/stop', (req, res) => {
  const sessionId = req.body.session
  if (!sessionId) return res.status(400).json({ error: 'session required' })
  const stopped = stopClaude(sessionId)
  if (!stopped) return res.status(409).json({ error: 'not running' })
  res.json({ ok: true })
})

// キュー全クリア
router.post('/stop-pending', (req, res) => {
  const sessionId = req.body.session
  if (!sessionId) return res.status(400).json({ error: 'session required' })
  stopPending(sessionId)
  res.json({ ok: true })
})

// キュー個別削除
router.delete('/pending/:sessionId/:index', (req, res) => {
  const { sessionId, index } = req.params
  removePending(sessionId, parseInt(index, 10))
  res.json({ ok: true })
})

// キュー個別更新
router.patch('/pending/:sessionId/:index', (req, res) => {
  const { sessionId, index } = req.params
  const { prompt } = req.body
  if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'prompt required' })
  const ok = updatePending(sessionId, parseInt(index, 10), prompt.trim())
  if (!ok) return res.status(404).json({ error: 'not found' })
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

// 自動再開スケジュール登録
router.post('/schedule-resume/:sessionId', (req, res) => {
  const { sessionId } = req.params
  const { resetAt, prompt, project, model, effort, thinking } = req.body
  if (!sessionId || !resetAt || !prompt) return res.status(400).json({ error: 'sessionId, resetAt, prompt required' })
  scheduleResume(sessionId, resetAt, prompt, project, model, effort, thinking)
  res.json({ ok: true })
})

// 自動再開スケジュールキャンセル
router.delete('/schedule-resume/:sessionId', (req, res) => {
  const { sessionId } = req.params
  cancelResume(sessionId)
  res.json({ ok: true })
})

// 自動再開スケジュール確認
router.get('/schedule-resume/:sessionId', (req, res) => {
  const { sessionId } = req.params
  const s = getSchedule(sessionId)
  res.json(s || { resetAt: null })
})

module.exports = router
