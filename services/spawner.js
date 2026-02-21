const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const config = require('../config/index')
const { broadcast, getState } = require('./stream')
const { gitPull } = require('./git')

const sessionsDir = path.join(__dirname, '..', 'sessions')

function saveClaudeSessionId(sessionId, claudeSessionId) {
  try {
    fs.mkdirSync(sessionsDir, { recursive: true })
    fs.writeFileSync(path.join(sessionsDir, `${sessionId}.json`), JSON.stringify({ claudeSessionId }))
  } catch {}
}

function getClaudeSessionId(sessionId) {
  try {
    return JSON.parse(fs.readFileSync(path.join(sessionsDir, `${sessionId}.json`), 'utf8')).claudeSessionId || null
  } catch { return null }
}

// claude プロセス起動
function startClaude(sessionId, prompt, model, project, claudeSessionId) {
  const projects = config.projects
  const projectDir = projects[project] || projects[Object.keys(projects)[0]]
  const s = getState(sessionId)

  const permissionMode = config.permissionMode || 'ask'
  const args = [
    ...(claudeSessionId ? ['--resume', claudeSessionId] : []),
    '-p', prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--permission-mode', permissionMode,
    ...(model ? ['--model', model] : []),
  ]

  broadcast(sessionId, {
    type: 'start',
    sessionId,
    project,
    model: model || 'default',
    timestamp: new Date().toISOString(),
  })

  const proc = spawn('claude', args, {
    cwd: projectDir,
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  s.process = proc
  proc.stdin.on('error', () => {})
  proc.stdin.end()

  proc.stdout.on('data', data => {
    data.toString().split('\n').filter(l => l.trim()).forEach(line => {
      try {
        const parsed = JSON.parse(line)
        if (parsed.type === 'system' && parsed.subtype === 'init' && !claudeSessionId) {
          saveClaudeSessionId(sessionId, parsed.session_id)
        }
        broadcast(sessionId, parsed)
      } catch {
        broadcast(sessionId, { type: 'raw', text: line })
      }
    })
  })

  proc.stderr.on('data', data => {
    const text = data.toString().trim()
    if (text) broadcast(sessionId, { type: 'stderr', text })
  })

  proc.on('close', code => {
    s.process = null
    broadcast(sessionId, { type: 'done', exitCode: code, timestamp: new Date().toISOString() })
    if (s.pendingPrompt) {
      const pending = s.pendingPrompt
      const pendingModel = s.pendingModel
      s.pendingPrompt = null
      s.pendingModel = null
      broadcast(sessionId, { type: 'queued_sent', message: pending })
      broadcast(sessionId, { type: 'user_input', text: pending })
      setTimeout(() => startClaude(sessionId, pending, pendingModel, project, getClaudeSessionId(sessionId)), 300)
    }
  })

  proc.on('error', err => {
    s.process = null
    broadcast(sessionId, { type: 'error', message: err.message })
  })
}

// プロセス停止
function stopClaude(sessionId) {
  const s = getState(sessionId)
  if (s.process) {
    s.pendingPrompt = null
    s.pendingModel = null
    s.process.kill('SIGTERM')
    return true
  }
  return false
}

// 実行中プロセスへの追加メッセージ注入
function injectPrompt(sessionId, prompt) {
  const s = getState(sessionId)
  if (!s.process || !s.process.stdin || s.process.stdin.destroyed) return false
  try {
    s.process.stdin.write(prompt + '\n')
    return true
  } catch {
    return false
  }
}

// ペンディングキャンセル
function stopPending(sessionId) {
  const s = getState(sessionId)
  s.pendingPrompt = null
  s.pendingModel = null
}

module.exports = { startClaude, stopClaude, stopPending, injectPrompt, gitPull }
