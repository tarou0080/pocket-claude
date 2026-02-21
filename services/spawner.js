const { spawn } = require('child_process')
const config = require('../config/index')
const { broadcast, getState } = require('./stream')
const { gitPull } = require('./git')

// claude プロセス起動
function startClaude(sessionId, prompt, model, project, isResume) {
  const projects = config.projects
  const projectDir = projects[project] || projects[Object.keys(projects)[0]]
  const s = getState(sessionId)

  const permissionMode = config.permissionMode || 'ask'
  const args = [
    ...(isResume ? ['--resume', sessionId] : ['--session-id', sessionId]),
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
        broadcast(sessionId, JSON.parse(line))
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
      setTimeout(() => startClaude(sessionId, pending, pendingModel, project, true), 300)
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
