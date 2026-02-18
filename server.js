const express = require('express')
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const { randomUUID } = require('crypto')

const app = express()
const PORT = process.env.PORT || 3333

// プロジェクト（作業ディレクトリ）設定
const PROJECTS = {
  'vibecoding': '/srv/shell/vibecoding',
  'johnctl':    '/srv/shell/johnctl',
  'shell':      '/srv/shell',
}

const SESSIONS_DIR = path.join(__dirname, 'sessions')
const LOGS_DIR     = path.join(__dirname, 'logs')
fs.mkdirSync(SESSIONS_DIR, { recursive: true })
fs.mkdirSync(LOGS_DIR, { recursive: true })

// 実行状態
let currentProcess = null
let currentBuffer  = []  // SSE再接続用バッファ
let sseClients     = []  // 接続中のSSEクライアント

// セッションID管理
function getSessionId(project) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, `${project}.json`), 'utf8'))
    return data.sessionId || null
  } catch { return null }
}

function saveSessionId(project, sessionId) {
  fs.writeFileSync(
    path.join(SESSIONS_DIR, `${project}.json`),
    JSON.stringify({ sessionId, updatedAt: new Date().toISOString() })
  )
}

// SSE全クライアントに配信
function broadcast(event) {
  const line = `data: ${JSON.stringify(event)}\n\n`
  sseClients.forEach(res => { try { res.write(line) } catch {} })
}

app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

// プロジェクト一覧
app.get('/api/projects', (_req, res) => {
  res.json(Object.keys(PROJECTS))
})

// 現在の状態
app.get('/api/status', (_req, res) => {
  res.json({ running: currentProcess !== null })
})

// プロンプト送信
app.post('/api/send', (req, res) => {
  const { prompt, project = 'shell' } = req.body
  if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'prompt required' })
  if (currentProcess)            return res.status(409).json({ error: 'Claude is running. Please wait.' })

  const projectDir = PROJECTS[project] || PROJECTS['shell']
  const existingId = getSessionId(project)
  const sessionId  = existingId || randomUUID()

  if (!existingId) saveSessionId(project, sessionId)

  const args = existingId
    ? ['--resume', sessionId, '-p', prompt, '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-mode', 'bypassPermissions']
    : ['--session-id', sessionId, '-p', prompt, '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-mode', 'bypassPermissions']

  // バッファリセット（新しいタスク開始）
  currentBuffer = []

  const proc = spawn('claude', args, { cwd: projectDir, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] })
  currentProcess = proc

  const startEvent = { type: 'start', project, sessionId, timestamp: new Date().toISOString() }
  currentBuffer.push(startEvent)
  broadcast(startEvent)

  proc.stdout.on('data', data => {
    data.toString().split('\n').filter(l => l.trim()).forEach(line => {
      try {
        const parsed = JSON.parse(line)
        currentBuffer.push(parsed)
        broadcast(parsed)
      } catch {
        const ev = { type: 'raw', text: line }
        currentBuffer.push(ev)
        broadcast(ev)
      }
    })
  })

  proc.stderr.on('data', data => {
    const ev = { type: 'stderr', text: data.toString().trim() }
    currentBuffer.push(ev)
    broadcast(ev)
  })

  proc.on('close', code => {
    currentProcess = null
    const ev = { type: 'done', exitCode: code, timestamp: new Date().toISOString() }
    currentBuffer.push(ev)
    broadcast(ev)
  })

  proc.on('error', err => {
    currentProcess = null
    const ev = { type: 'error', message: err.message }
    currentBuffer.push(ev)
    broadcast(ev)
  })

  res.json({ ok: true, project, resumed: !!existingId, sessionId })
})

// セッションリセット（プロジェクトの会話を新規開始）
app.post('/api/reset', (req, res) => {
  if (currentProcess) return res.status(409).json({ error: 'Claude is running.' })
  const { project = 'shell' } = req.body
  const file = path.join(SESSIONS_DIR, `${project}.json`)
  try { fs.unlinkSync(file) } catch {}
  res.json({ ok: true, project })
})

// SSEエンドポイント
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')  // nginxバッファリング無効

  // 再接続時：バッファを全送信
  currentBuffer.forEach(ev => res.write(`data: ${JSON.stringify(ev)}\n\n`))

  sseClients.push(res)

  // keepalive（nginx timeout対策）
  const heartbeat = setInterval(() => { try { res.write(': ping\n\n') } catch {} }, 20000)

  req.on('close', () => {
    clearInterval(heartbeat)
    sseClients = sseClients.filter(c => c !== res)
  })
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(`pocket-claude running on port ${PORT}`)
})
