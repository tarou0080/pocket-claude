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

// claude プロセス起動（常駐モード: --input-format stream-json）
function startClaude(sessionId, prompt, model, project, claudeSessionId, effort, thinking, imageData) {
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
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--permission-mode', permissionMode,
    ...(model ? ['--model', model] : []),
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
  s.pendingQueue = s.pendingQueue || []
  proc.stdin.on('error', () => {})

  // 最初のメッセージ送信
  _sendMessage(proc, prompt, imageData)

  proc.stdout.on('data', data => {
    data.toString().split('\n').filter(l => l.trim()).forEach(line => {
      try {
        const parsed = JSON.parse(line)

        // session_id の初回取得
        if (parsed.type === 'system' && parsed.subtype === 'init' && !claudeSessionId) {
          saveClaudeSessionId(sessionId, parsed.session_id)
        }

        // AskUserQuestion の tool_use を検知 → フロントに通知
        if (parsed.type === 'assistant' && parsed.message?.content) {
          parsed.message.content.forEach(item => {
            if (item.type === 'tool_use' && item.name === 'AskUserQuestion') {
              s.pendingAsk = { toolUseId: item.id, questions: item.input?.questions || [] }
              broadcast(sessionId, {
                type: 'ask_user_question',
                toolUseId: item.id,
                questions: item.input?.questions || [],
              })
            }
          })
        }

        broadcast(sessionId, parsed)

        // result イベント = 1ターン完了 → キューを処理
        if (parsed.type === 'result') {
          s.pendingAsk = null
          _processQueue(sessionId, project)
        }
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
    s.pendingAsk = null
    broadcast(sessionId, { type: 'done', exitCode: code, timestamp: new Date().toISOString() })
  })

  proc.on('error', err => {
    s.process = null
    s.pendingAsk = null
    broadcast(sessionId, { type: 'error', message: err.message })
  })
}

// stdin に user メッセージを JSON で送信
function _sendMessage(proc, prompt, imageData) {
  if (!proc || !proc.stdin || proc.stdin.destroyed) return

  const content = []

  // 画像が添付されている場合
  if (imageData) {
    const images = Array.isArray(imageData) ? imageData : [imageData]
    images.forEach(img => {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: img.mediaType,
          data: img.data,
        },
      })
    })
  }

  content.push({ type: 'text', text: prompt })

  const msg = {
    type: 'user',
    message: {
      role: 'user',
      content,
    },
  }

  try {
    proc.stdin.write(JSON.stringify(msg) + '\n')
  } catch {}
}

// キューから次のメッセージを処理
function _processQueue(sessionId, project) {
  const s = getState(sessionId)
  if (!s.pendingQueue || s.pendingQueue.length === 0) return
  if (!s.process) return

  const next = s.pendingQueue.shift()
  broadcast(sessionId, { type: 'queue_update', queue: s.pendingQueue.map(q => ({ prompt: q.prompt })) })
  broadcast(sessionId, { type: 'user_input', text: next.prompt })
  _sendMessage(s.process, next.prompt, next.imageData || null)
}

// プロセス停止
function stopClaude(sessionId) {
  const s = getState(sessionId)
  if (s.process) {
    s.pendingQueue = []
    s.pendingAsk = null
    s.process.kill('SIGTERM')
    return true
  }
  return false
}

// AskUserQuestion への応答を注入
function respondToAsk(sessionId, answer) {
  const s = getState(sessionId)
  if (!s.process || !s.process.stdin || s.process.stdin.destroyed) return false
  broadcast(sessionId, { type: 'user_input', text: answer })
  _sendMessage(s.process, answer)
  return true
}

// 実行中プロセスへのプロンプト注入（割り込み送信）
function injectPrompt(sessionId, prompt, imageData) {
  const s = getState(sessionId)
  if (!s.process || !s.process.stdin || s.process.stdin.destroyed) return false
  try {
    broadcast(sessionId, { type: 'user_input', text: prompt })
    _sendMessage(s.process, prompt, imageData)
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

module.exports = { startClaude, stopClaude, stopPending, removePending, updatePending, injectPrompt, respondToAsk, gitPull }
