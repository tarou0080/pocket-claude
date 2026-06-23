const { spawn } = require('child_process')
const config = require('../config/index')
const { broadcast, getState } = require('./stream')
const { gitPull } = require('./git')
const { saveClaudeSessionId } = require('./sessions')
const { parseResetTime } = require('./reset-time')

// claude プロセス起動（常駐モード: --input-format stream-json）
function startClaude(sessionId, prompt, model, project, claudeSessionId, effort, thinking, imageData) {
  const projects = config.projects
  const projectDir = projects[project] || projects[Object.keys(projects)[0]]
  const s = getState(sessionId)

  const permissionMode = config.permissionMode || 'ask'

  // プロキシ経由モデル(GLM等): 該当時のみ翻訳プロキシへ向ける環境変数を子プロセスに注入する。
  // 非選択時は process.env そのまま＝プロキシが落ちていても他モデルは完全に無影響。
  const proxyEnv = (config.proxyModels && config.proxyModels[model]) || null

  const settings = {}
  // effort/alwaysThinkingEnabled は Claude 固有設定。プロキシ経由(GLM等)では送らない。
  if (!proxyEnv) {
    if (effort) settings.effort = effort
    if (thinking === 'on' || thinking === true) settings.alwaysThinkingEnabled = true
    else if (thinking === 'off' || thinking === false) settings.alwaysThinkingEnabled = false
  }

  const args = [
    ...(claudeSessionId ? ['--resume', claudeSessionId] : []),
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--permission-mode', permissionMode,
    // ヘッドレス(stream-json)モードでは AskUserQuestion を対話的に解決できず、CLIが
    // 即座に is_error の tool_result を自己注入してターンを閉じる（モデルは「未回答＝スキップ」と認識）。
    // 選択肢ツールを無効化し、モデルには素のテキストで質問させる。回答は通常の /api/send で返す。
    '--disallowed-tools', 'AskUserQuestion',
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
    env: { ...process.env, ...(proxyEnv || {}) },
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

        if (parsed.type === 'assistant' && parsed.error === 'rate_limit') {
          const limitText = parsed.message?.content?.find(c => c.type === 'text')?.text || ''
          console.log(`[rate-limit] broadcast sessionId=${sessionId} text="${limitText}"`)
          // サーバーを真実源としてresetAtを保存する。クライアントが切断中（iPhoneバックグラウンド等）でも
          // 再接続時の restoreRateLimitPanel がGETで拾えるようにする。
          // prompt=null の保存は既存のON登録（prompt有り）を上書きしない（scheduler側ガード）。
          const resetAt = parseResetTime(limitText)
          if (resetAt) {
            const { scheduleResume } = require('./scheduler')
            const cfg = require('../config/index')
            if (cfg.resumeDefaultOn) {
              // resumeDefaultON=true: prompt付きで登録 → doResumeタイマーが入る
              // 既存にprompt有りのON登録があればscheduler側ガードで何もしない（二重登録しない）
              const resumePrompt = '続けてください'
              scheduleResume(sessionId, resetAt.toISOString(), resumePrompt, project)
              console.log(`[rate-limit] auto-resume default-on registered sessionId=${sessionId} resetAt=${resetAt.toISOString()}`)
            } else {
              // resumeDefaultOn=false: 状態記録のみ（タイマーなし）
              scheduleResume(sessionId, resetAt.toISOString(), null, project)
              console.log(`[rate-limit] saved resetAt=${resetAt.toISOString()}`)
            }
          }
        }

        broadcast(sessionId, parsed)

        // result イベント = 1ターン完了 → キューを処理
        if (parsed.type === 'result') {
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
    broadcast(sessionId, { type: 'done', exitCode: code, timestamp: new Date().toISOString() })
  })

  proc.on('error', err => {
    s.process = null
    // 詳細はサーバーログへ。クライアントには内部パス等を漏らさない一般メッセージのみ
    console.error(`[spawn:error] sessionId=${sessionId} ${err.message}`)
    broadcast(sessionId, { type: 'error', message: 'Failed to start Claude process' })
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

  if (prompt) content.push({ type: 'text', text: prompt })

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
    s.process.kill('SIGTERM')
    return true
  }
  return false
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

module.exports = { startClaude, stopClaude, stopPending, removePending, updatePending, injectPrompt, gitPull }
