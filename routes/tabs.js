const express = require('express')
const fs = require('fs')
const { randomUUID } = require('crypto')
const router = express.Router()
const { loadTabs, saveTabs, getDefaultProject } = require('../services/tabs')
const { getState, deleteState, logFile } = require('../services/stream')
const { UUID_RE, CLAUDE_PROJECTS_DIR } = require('../services/history')
const config = require('../config/index')

// タブ一覧
router.get('/', (_req, res) => {
  const tabs = loadTabs()
  res.json(tabs.map(t => ({ ...t, running: getState(t.id).process != null })))
})

// タブ作成
router.post('/', (req, res) => {
  const tabs = loadTabs()
  // リクエストボディからプロジェクトを受け取る（なければデフォルト）
  const project = req.body.project || getDefaultProject()
  const newTab = {
    id: randomUUID(),
    name: `Conversation ${tabs.length + 1}`,
    project: project,
    sessionId: null,
  }
  tabs.push(newTab)
  saveTabs(tabs)
  res.json(newTab)
})

// タブ更新
router.patch('/:id', (req, res) => {
  const tabs = loadTabs()
  const tab = tabs.find(t => t.id === req.params.id)
  if (!tab) return res.status(404).json({ error: 'tab not found' })
  if (req.body.name !== undefined) tab.name = req.body.name
  if (req.body.project !== undefined) {
    const projects = config.projects
    if (projects[req.body.project]) tab.project = req.body.project
  }
  saveTabs(tabs)
  res.json(tab)
})

// タブ削除
router.delete('/:id', (req, res) => {
  const tabs = loadTabs()
  const idx = tabs.findIndex(t => t.id === req.params.id)
  if (idx === -1) return res.status(404).json({ error: 'tab not found' })
  // 最後のタブでも削除可能（フロントエンドで新規タブ作成）
  const [removed] = tabs.splice(idx, 1)
  saveTabs(tabs)
  const s = getState(removed.id)
  if (s.process) s.process.kill('SIGTERM')
  deleteState(removed.id)
  fs.unlink(logFile(removed.id), () => {})
  res.json({ ok: true })
})

// タブをfork（履歴セッションから新しいタブを作成）
router.post('/fork', (req, res) => {
  const { sessionId } = req.body
  if (!sessionId || !UUID_RE.test(sessionId)) {
    return res.status(400).json({ error: 'invalid sessionId' })
  }

  // 履歴ファイルの存在確認
  const historyPath = require('path').join(CLAUDE_PROJECTS_DIR, `${sessionId}.jsonl`)
  if (!fs.existsSync(historyPath)) {
    return res.status(404).json({ error: 'session not found' })
  }

  // タイトル取得（履歴の最初のユーザーメッセージ）
  let title = '再開'
  try {
    const lines = fs.readFileSync(historyPath, 'utf8').split('\n').filter(l => l.trim())
    for (const line of lines) {
      try {
        const d = JSON.parse(line)
        if (d.type === 'user') {
          const content = d.message?.content
          if (typeof content === 'string') title = content.slice(0, 12)
          else if (Array.isArray(content)) {
            const textBlock = content.find(c => c.type === 'text')
            if (textBlock) title = textBlock.text.slice(0, 12)
          }
          break
        }
      } catch {}
    }
  } catch {}

  // 新しいタブ作成
  const tabs = loadTabs()
  const newTab = {
    id: randomUUID(),
    name: `${title} (Resumed)`,
    project: getDefaultProject(),
    sessionId: sessionId,
  }
  tabs.push(newTab)
  saveTabs(tabs)

  res.json(newTab)
})

module.exports = router
