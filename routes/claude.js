const express = require('express')
const fs = require('fs')
const router = express.Router()
const { loadTabs, saveTabs } = require('../services/tabs')
const { startClaude, stopClaude, stopPending, injectPrompt, gitPull } = require('../services/spawner')
const { getState, broadcast, logFile } = require('../services/stream')
const config = require('../config/index')

// プロジェクト一覧
router.get('/projects', (_req, res) => {
  res.json(Object.keys(config.projects))
})

// 状態確認
router.get('/status', (req, res) => {
  const tabId = req.query.tab
  if (!tabId) return res.status(400).json({ error: 'tab required' })
  const s = getState(tabId)
  res.json({ running: s.process !== null, pending: s.pendingPrompt || null })
})

// プロンプト送信
router.post('/send', async (req, res) => {
  const { prompt, tab: tabId, model } = req.body
  if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'prompt required' })
  if (!tabId) return res.status(400).json({ error: 'tab required' })

  const tabs = loadTabs()
  const tab = tabs.find(t => t.id === tabId)
  if (!tab) return res.status(404).json({ error: 'tab not found' })

  // タブ名の自動生成（初回送信時）
  if (!tab.sessionId && /^会話\d+$/.test(tab.name)) {
    tab.name = prompt.slice(0, 12).trim()
    saveTabs(tabs)
  }

  const s = getState(tabId)

  if (s.process) {
    broadcast(tabId, { type: 'user_input', text: prompt })
    const injected = injectPrompt(tabId, prompt)
    if (!injected) {
      // stdin injection 不可の場合は従来のキューにフォールバック（UI通知なし）
      s.pendingPrompt = prompt
      s.pendingModel = model || null
    }
    return res.json({ ok: true, injected })
  }

  // git pull
  const projects = config.projects
  const projectDir = projects[tab.project]
  if (projectDir) {
    const pulled = await gitPull(projectDir)
    if (pulled) broadcast(tabId, { type: 'system', text: `git pull: ${pulled}` })
  }

  broadcast(tabId, { type: 'user_input', text: prompt })
  startClaude(tabId, prompt, model)
  res.json({ ok: true, tabId, queued: false })
})

// 停止
router.post('/stop', (req, res) => {
  const tabId = req.body.tab
  if (!tabId) return res.status(400).json({ error: 'tab required' })
  const stopped = stopClaude(tabId)
  if (!stopped) return res.status(409).json({ error: 'not running' })
  res.json({ ok: true })
})

// ペンディングキャンセル
router.post('/stop-pending', (req, res) => {
  const tabId = req.body.tab
  if (!tabId) return res.status(400).json({ error: 'tab required' })
  stopPending(tabId)
  res.json({ ok: true })
})

// セッションリセット
router.post('/reset', (req, res) => {
  const tabId = req.body.tab
  if (!tabId) return res.status(400).json({ error: 'tab required' })
  const s = getState(tabId)
  if (s.process) return res.status(409).json({ error: 'Claude is running.' })
  const tabs = loadTabs()
  const tab = tabs.find(t => t.id === tabId)
  if (tab) {
    tab.sessionId = null
    saveTabs(tabs)
  }
  s.buffer = []
  fs.unlink(logFile(tabId), () => {})
  res.json({ ok: true, tabId })
})

module.exports = router
