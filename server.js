const express = require('express')
const { spawn, exec } = require('child_process')
const fs = require('fs')
const path = require('path')
const { randomUUID } = require('crypto')

const app = express()

// Load config
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'))
  } catch {
    return {
      port: 3333,
      permissionMode: 'ask',
      sessionDir: './sessions',
      logsDir: './logs'
    }
  }
}

const config = loadConfig()
const PORT = process.env.PORT || config.port || 3333

const SESSIONS_DIR = path.join(__dirname, config.sessionDir || 'sessions')
const LOGS_DIR     = path.join(__dirname, config.logsDir || 'logs')
const TABS_FILE    = path.join(__dirname, 'tabs.json')
fs.mkdirSync(SESSIONS_DIR, { recursive: true })
fs.mkdirSync(LOGS_DIR, { recursive: true })

// プロジェクト設定読み込み
function loadProjects() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'projects.json'), 'utf8'))
  } catch {
    const homeDir = process.env.HOME || path.join('/home', process.env.USER || 'user')
    return { home: homeDir }
  }
}

// タブ管理
function loadTabs() {
  try {
    return JSON.parse(fs.readFileSync(TABS_FILE, 'utf8'))
  } catch {
    return []
  }
}

function saveTabs(tabs) {
  fs.writeFileSync(TABS_FILE, JSON.stringify(tabs, null, 2))
}

function getDefaultProject() {
  return Object.keys(loadProjects())[0]
}

// 初回起動時にタブが0件なら既存セッションから移行 or デフォルト作成
function ensureDefaultTabs() {
  const tabs = loadTabs()
  if (tabs.length > 0) return

  const projects = loadProjects()
  const migrated = []
  for (const [proj] of Object.entries(projects)) {
    const sessFile = path.join(SESSIONS_DIR, `${proj}.json`)
    try {
      const { sessionId } = JSON.parse(fs.readFileSync(sessFile, 'utf8'))
      migrated.push({ id: randomUUID(), name: proj, project: proj, sessionId })
    } catch { /* セッションなし */ }
  }
  if (migrated.length > 0) {
    saveTabs(migrated)
  } else {
    saveTabs([{ id: randomUUID(), name: '会話1', project: getDefaultProject(), sessionId: null }])
  }
}

ensureDefaultTabs()

// タブIDごとの実行状態
const state = {}

function getState(tabId) {
  if (!state[tabId]) {
    state[tabId] = { process: null, buffer: [], sseClients: [], pendingPrompt: null, pendingModel: null }
  }
  return state[tabId]
}

// セッションID管理
function getSessionId(tabId) {
  const tabs = loadTabs()
  const tab = tabs.find(t => t.id === tabId)
  return tab?.sessionId || null
}

function saveSessionId(tabId, sessionId) {
  const tabs = loadTabs()
  const tab = tabs.find(t => t.id === tabId)
  if (tab) { tab.sessionId = sessionId; saveTabs(tabs) }
}

// ログファイルパス
function logFile(tabId) {
  return path.join(LOGS_DIR, `${tabId}.jsonl`)
}

// 全クライアントに配信（バッファ＋ファイルにも積む）
function broadcast(tabId, event) {
  const s = getState(tabId)
  s.buffer.push(event)
  fs.appendFile(logFile(tabId), JSON.stringify(event) + '\n', () => {})
  const line = `data: ${JSON.stringify(event)}\n\n`
  s.sseClients.forEach(res => { try { res.write(line) } catch {} })
}

// ログファイルからバッファを復元
function loadLogFile(tabId) {
  try {
    return fs.readFileSync(logFile(tabId), 'utf8')
      .split('\n').filter(l => l.trim())
      .map(l => JSON.parse(l))
  } catch { return [] }
}

// git pull（.git があるディレクトリのみ）
function gitPull(dir) {
  return new Promise(resolve => {
    if (!fs.existsSync(path.join(dir, '.git'))) return resolve(null)
    exec('git pull --ff-only', { cwd: dir, timeout: 30000 }, (err, stdout, stderr) => {
      if (err) return resolve(`pull failed: ${stderr.trim()}`)
      const msg = stdout.trim()
      resolve(msg && msg !== 'Already up to date.' ? msg : null)
    })
  })
}

// claude プロセス起動
function startClaude(tabId, prompt, model) {
  const tabs = loadTabs()
  const tab = tabs.find(t => t.id === tabId)
  if (!tab) return

  const projects = loadProjects()
  const projectDir = projects[tab.project] || projects[Object.keys(projects)[0]]
  const s = getState(tabId)
  const existingId = getSessionId(tabId)
  const sessionId  = existingId || randomUUID()
  if (!existingId) saveSessionId(tabId, sessionId)

  const permissionMode = config.permissionMode || 'ask'
  const args = [
    ...(existingId ? ['--resume', sessionId] : ['--session-id', sessionId]),
    '-p', prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--permission-mode', permissionMode,
    ...(model ? ['--model', model] : []),
  ]

  broadcast(tabId, {
    type: 'start', tabId, project: tab.project, sessionId,
    model: model || 'default',
    timestamp: new Date().toISOString(),
  })

  const proc = spawn('claude', args, {
    cwd: projectDir,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  s.process = proc

  proc.stdout.on('data', data => {
    data.toString().split('\n').filter(l => l.trim()).forEach(line => {
      try { broadcast(tabId, JSON.parse(line)) }
      catch { broadcast(tabId, { type: 'raw', text: line }) }
    })
  })

  proc.stderr.on('data', data => {
    const text = data.toString().trim()
    if (text) broadcast(tabId, { type: 'stderr', text })
  })

  proc.on('close', code => {
    s.process = null
    broadcast(tabId, { type: 'done', exitCode: code, timestamp: new Date().toISOString() })
    if (s.pendingPrompt) {
      const pending      = s.pendingPrompt
      const pendingModel = s.pendingModel
      s.pendingPrompt = null
      s.pendingModel  = null
      broadcast(tabId, { type: 'queued_sent', message: pending })
      broadcast(tabId, { type: 'user_input', text: pending })
      setTimeout(() => startClaude(tabId, pending, pendingModel), 300)
    }
  })

  proc.on('error', err => {
    s.process = null
    broadcast(tabId, { type: 'error', message: err.message })
  })
}

app.use(express.json())

// Root endpoint - serve index.html with dynamic lang attribute
app.get('/', (req, res) => {
  const lang = config.uiLang || 'en'
  const htmlPath = path.join(__dirname, 'public', 'index.html')
  let html = fs.readFileSync(htmlPath, 'utf8')
  html = html.replace('<html lang="en">', `<html lang="${lang}">`)
  res.send(html)
})

app.use(express.static(path.join(__dirname, 'public')))

// プロジェクト一覧
app.get('/api/projects', (_req, res) => {
  res.json(Object.keys(loadProjects()))
})

// タブ一覧
app.get('/api/tabs', (_req, res) => {
  const tabs = loadTabs()
  res.json(tabs.map(t => ({ ...t, running: state[t.id]?.process != null })))
})

// タブ作成
app.post('/api/tabs', (req, res) => {
  const tabs = loadTabs()
  const newTab = {
    id: randomUUID(),
    name: `会話${tabs.length + 1}`,
    project: getDefaultProject(),
    sessionId: null,
  }
  tabs.push(newTab)
  saveTabs(tabs)
  res.json(newTab)
})

// タブ更新
app.patch('/api/tabs/:id', (req, res) => {
  const tabs = loadTabs()
  const tab = tabs.find(t => t.id === req.params.id)
  if (!tab) return res.status(404).json({ error: 'tab not found' })
  if (req.body.name !== undefined) tab.name = req.body.name
  if (req.body.project !== undefined) {
    const projects = loadProjects()
    if (projects[req.body.project]) tab.project = req.body.project
  }
  saveTabs(tabs)
  res.json(tab)
})

// タブ削除
app.delete('/api/tabs/:id', (req, res) => {
  const tabs = loadTabs()
  const idx = tabs.findIndex(t => t.id === req.params.id)
  if (idx === -1) return res.status(404).json({ error: 'tab not found' })
  if (tabs.length === 1) return res.status(400).json({ error: 'cannot delete last tab' })
  const [removed] = tabs.splice(idx, 1)
  saveTabs(tabs)
  const s = state[removed.id]
  if (s?.process) s.process.kill('SIGTERM')
  delete state[removed.id]
  fs.unlink(logFile(removed.id), () => {})
  res.json({ ok: true })
})

// タブをfork（履歴セッションから新しいタブを作成）
app.post('/api/tabs/fork', (req, res) => {
  const { sessionId } = req.body
  if (!sessionId || !UUID_RE.test(sessionId)) {
    return res.status(400).json({ error: 'invalid sessionId' })
  }

  // 履歴ファイルの存在確認
  const historyPath = path.join(CLAUDE_PROJECTS_DIR, `${sessionId}.jsonl`)
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
    name: `${title}（再開）`,
    project: getDefaultProject(),
    sessionId: sessionId,
  }
  tabs.push(newTab)
  saveTabs(tabs)

  res.json(newTab)
})

// 状態確認
app.get('/api/status', (req, res) => {
  const tabId = req.query.tab
  if (!tabId) return res.status(400).json({ error: 'tab required' })
  const s = getState(tabId)
  res.json({ running: s.process !== null, pending: s.pendingPrompt || null })
})

// プロンプト送信
app.post('/api/send', async (req, res) => {
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
    s.pendingPrompt = prompt
    s.pendingModel  = model || null
    broadcast(tabId, { type: 'queued', message: prompt })
    return res.json({ ok: true, queued: true })
  }

  // git pull
  const projects = loadProjects()
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
app.post('/api/stop', (req, res) => {
  const tabId = req.body.tab
  if (!tabId) return res.status(400).json({ error: 'tab required' })
  const s = getState(tabId)
  if (!s.process) return res.status(409).json({ error: 'not running' })
  s.pendingPrompt = null
  s.pendingModel  = null
  s.process.kill('SIGTERM')
  res.json({ ok: true })
})

// ペンディングキャンセル
app.post('/api/stop-pending', (req, res) => {
  const tabId = req.body.tab
  if (!tabId) return res.status(400).json({ error: 'tab required' })
  const s = getState(tabId)
  s.pendingPrompt = null
  s.pendingModel  = null
  res.json({ ok: true })
})

// セッションリセット
app.post('/api/reset', (req, res) => {
  const tabId = req.body.tab
  if (!tabId) return res.status(400).json({ error: 'tab required' })
  const s = getState(tabId)
  if (s.process) return res.status(409).json({ error: 'Claude is running.' })
  const tabs = loadTabs()
  const tab = tabs.find(t => t.id === tabId)
  if (tab) { tab.sessionId = null; saveTabs(tabs) }
  s.buffer = []
  fs.unlink(logFile(tabId), () => {})
  res.json({ ok: true, tabId })
})

// SSEエンドポイント
app.get('/api/stream', (req, res) => {
  const tabId = req.query.tab
  if (!tabId) { res.status(400).end(); return }

  const s = getState(tabId)

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')

  // メモリバッファが空ならファイルから復元
  if (s.buffer.length === 0) {
    s.buffer = loadLogFile(tabId)
  }
  s.buffer.forEach(ev => res.write(`data: ${JSON.stringify(ev)}\n\n`))
  s.sseClients.push(res)

  const heartbeat = setInterval(() => { try { res.write(': ping\n\n') } catch {} }, 20000)
  req.on('close', () => {
    clearInterval(heartbeat)
    s.sseClients = s.sseClients.filter(c => c !== res)
  })
})

// ── 履歴API ──
const homeDir = process.env.HOME || path.join('/home', process.env.USER || 'user')
const homeDirNormalized = homeDir.replace(/\//g, '-')
const CLAUDE_PROJECTS_DIR = path.join(homeDir, '.claude', 'projects', homeDirNormalized)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// セッション一覧
app.get('/api/history', (_req, res) => {
  let files
  try {
    files = fs.readdirSync(CLAUDE_PROJECTS_DIR).filter(f => f.endsWith('.jsonl'))
  } catch {
    return res.json([])
  }

  const sessions = []
  for (const file of files) {
    const sessionId = file.replace('.jsonl', '')
    if (!UUID_RE.test(sessionId)) continue
    const filePath = path.join(CLAUDE_PROJECTS_DIR, file)
    let stat, title = '', updatedAt = '', msgCount = 0
    try {
      stat = fs.statSync(filePath)
      updatedAt = stat.mtime.toISOString()
    } catch { continue }
    try {
      const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(l => l.trim())
      for (const line of lines) {
        try {
          const d = JSON.parse(line)
          if (d.type === 'user') {
            msgCount++
            if (!title) {
              const content = d.message?.content
              if (typeof content === 'string') title = content
              else if (Array.isArray(content)) {
                const textBlock = content.find(c => c.type === 'text')
                if (textBlock) title = textBlock.text
              }
            }
          } else if (d.type === 'assistant') {
            msgCount++
          }
        } catch {}
      }
    } catch {}
    if (!title) title = `(${sessionId.slice(0, 8)})`
    sessions.push({ sessionId, title: title.slice(0, 80), updatedAt, msgCount })
  }

  sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  res.json(sessions)
})

// 特定セッションの会話内容
app.get('/api/history/:sessionId', (req, res) => {
  const { sessionId } = req.params
  if (!UUID_RE.test(sessionId)) return res.status(400).json({ error: 'invalid sessionId' })

  const filePath = path.join(CLAUDE_PROJECTS_DIR, `${sessionId}.jsonl`)
  let lines
  try {
    lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(l => l.trim())
  } catch {
    return res.status(404).json({ error: 'session not found' })
  }

  const messages = []
  for (const line of lines) {
    try {
      const d = JSON.parse(line)
      if (d.type === 'user') {
        const content = d.message?.content
        let text = ''
        if (typeof content === 'string') text = content
        else if (Array.isArray(content)) {
          text = content.filter(c => c.type === 'text').map(c => c.text).join('\n')
        }
        if (text.trim()) messages.push({ role: 'user', text, timestamp: d.timestamp })
      } else if (d.type === 'assistant') {
        const content = d.message?.content
        if (!Array.isArray(content)) continue
        const text = content.filter(c => c.type === 'text').map(c => c.text).join('\n')
        if (text.trim()) messages.push({ role: 'assistant', text, timestamp: d.timestamp })
      }
    } catch {}
  }

  res.json(messages)
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(`pocket-claude v3 running on port ${PORT}`)
})
