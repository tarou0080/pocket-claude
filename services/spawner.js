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
function startClaude(sessionId, prompt, model, project, claudeSessionId, effort, thinking) {
  const projects = config.projects
  const projectDir = projects[project] || projects[Object.keys(projects)[0]]
  const s = getState(sessionId)

  const permissionMode = config.permissionMode || 'ask'
  const settings = {}
  if (effort) settings.effort = effort
  if (thinking === 'on' || thinking === true) settings.alwaysThinkingEnabled = true
  else if (thinking === 'off' || thinking === false) settings.alwaysThinkingEnabled = false
  const args = [
    ...(claudeSessionId ? ['--resume', claudeSessionId] : []),
    '-p', prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--permission-mode', permissionMode,
    ...(model  ? ['--model',  model]  : []),
    ...(Object.keys(settings).length ? ['--settings', JSON.stringify(settings)] : []),
  ]

  broadcast(sessionId, {
    type: 'start',
    sessionId,
    project,
    model: model || 'default',
    timestamp: new Date().toISOString(),
  })

  console.log(`[spawn] project=${project} cwd=${projectDir}`)
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

    if (s.pendingQueue && s.pendingQueue.length > 0) {
      const next = s.pendingQueue.shift()
      broadcast(sessionId, { type: 'queue_update', queue: s.pendingQueue.map(q => ({ prompt: q.prompt })) })
      broadcast(sessionId, { type: 'user_input', text: next.prompt })
      setTimeout(() => startClaude(sessionId, next.prompt, next.model, project, getClaudeSessionId(sessionId), next.effort, next.thinking), 300)
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
    s.pendingQueue = []
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

// キュー個別削除
function removePending(sessionId, index) {
  const s = getState(sessionId)
  if (!s.pendingQueue) return
  s.pendingQueue.splice(index, 1)
  broadcast(sessionId, { type: 'queue_update', queue: s.pendingQueue.map(q => ({ prompt: q.prompt })) })
}

// キュー全クリア
function stopPending(sessionId) {
  const s = getState(sessionId)
  s.pendingQueue = []
  broadcast(sessionId, { type: 'queue_update', queue: [] })
}

// キュー個別更新
function updatePending(sessionId, index, prompt) {
  const s = getState(sessionId)
  if (!s.pendingQueue || !s.pendingQueue[index]) return false
  s.pendingQueue[index].prompt = prompt
  broadcast(sessionId, { type: 'queue_update', queue: s.pendingQueue.map(q => ({ prompt: q.prompt })) })
  return true
}

module.exports = { startClaude, stopClaude, stopPending, removePending, updatePending, injectPrompt, gitPull }
