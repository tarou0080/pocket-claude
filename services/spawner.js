const { spawn } = require('child_process')
const { randomUUID } = require('crypto')
const config = require('../config/index')
const { loadTabs } = require('./tabs')
const { getSessionId, saveSessionId } = require('./sessions')
const { broadcast, getState } = require('./stream')
const { gitPull } = require('./git')

// claude プロセス起動
function startClaude(tabId, prompt, model) {
  const tabs = loadTabs()
  const tab = tabs.find(t => t.id === tabId)
  if (!tab) return

  const projects = config.projects
  const projectDir = projects[tab.project] || projects[Object.keys(projects)[0]]
  const s = getState(tabId)
  const existingId = getSessionId(tabId)
  const sessionId = existingId || randomUUID()
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
    type: 'start',
    tabId,
    project: tab.project,
    sessionId,
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
      try {
        broadcast(tabId, JSON.parse(line))
      } catch {
        broadcast(tabId, { type: 'raw', text: line })
      }
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
      const pending = s.pendingPrompt
      const pendingModel = s.pendingModel
      s.pendingPrompt = null
      s.pendingModel = null
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

// プロセス停止
function stopClaude(tabId) {
  const s = getState(tabId)
  if (s.process) {
    s.pendingPrompt = null
    s.pendingModel = null
    s.process.kill('SIGTERM')
    return true
  }
  return false
}

// ペンディングキャンセル
function stopPending(tabId) {
  const s = getState(tabId)
  s.pendingPrompt = null
  s.pendingModel = null
}

module.exports = { startClaude, stopClaude, stopPending, gitPull }
