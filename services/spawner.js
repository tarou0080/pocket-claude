const { spawn } = require('child_process')
const { randomUUID } = require('crypto')
const config = require('../config/index')
const { broadcast, getState } = require('./stream')
const { gitPull } = require('./git')
const { saveClaudeSessionId, getClaudeSessionId } = require('./sessions')
const { parseResetTime } = require('./reset-time')
const { getProxyEnv } = require('./proxy-route')

// stdin へ送る control_request の応答を待つ標準タイムアウト。
// 実測(interrupt/set_model とも成功時は数ms〜十数msでACKが返る)に対して十分な余裕を持たせつつ、
// ACKが来ない場合のフォールバック(SIGTERM/kill+resume)への切替を遅らせすぎない値。
const CONTROL_TIMEOUT_MS = 1800

// claude CLI (stream-json) の stdin へ制御メッセージ(control_request)を送り、対応する
// control_response を待って解決する。タイムアウト/送信失敗時は null を返す＝呼び出し元は
// これを「ACKが来ない/失敗した」として現行動作へフォールバックすること。
function sendControlMessage(proc, subtype, extra = {}, timeoutMs = CONTROL_TIMEOUT_MS) {
  return new Promise(resolve => {
    if (!proc || !proc.stdin || proc.stdin.destroyed) return resolve(null)
    const requestId = 'req_' + randomUUID()
    if (!proc._controlWaiters) proc._controlWaiters = new Map()
    const timer = setTimeout(() => {
      proc._controlWaiters.delete(requestId)
      resolve(null)
    }, timeoutMs)
    proc._controlWaiters.set(requestId, response => {
      clearTimeout(timer)
      proc._controlWaiters.delete(requestId)
      resolve(response)
    })
    try {
      proc.stdin.write(JSON.stringify({ type: 'control_request', request_id: requestId, request: { subtype, ...extra } }) + '\n')
    } catch {
      clearTimeout(timer)
      proc._controlWaiters.delete(requestId)
      resolve(null)
    }
  })
}

// claude プロセス起動（常駐モード: --input-format stream-json）
function startClaude(sessionId, prompt, model, project, claudeSessionId, effort, thinking, imageData) {
  const projects = config.projects
  const projectDir = projects[project] || projects[Object.keys(projects)[0]]
  const s = getState(sessionId)
  // spawn時のモデルを記録。/api/send がアイドル時のモデル変更を検知し、
  // 異なれば --resume で再起動して新モデルを適用するために使う。
  s.model = model || null

  // claude CLI が受け付けない値を渡すと起動そのものが失敗する（画面には stderr だけが出て
  // 原因が分かりにくい）。未知の値は既定へ落とし、理由をサーバーログに残す。
  const PERMISSION_MODES = ['acceptEdits', 'auto', 'bypassPermissions', 'manual', 'dontAsk', 'plan']
  let permissionMode = config.permissionMode || 'acceptEdits'
  if (!PERMISSION_MODES.includes(permissionMode)) {
    console.warn(`[config] unknown permissionMode "${permissionMode}" -> fallback to acceptEdits (valid: ${PERMISSION_MODES.join(', ')})`)
    permissionMode = 'acceptEdits'
  }

  // プロキシ経由モデル(GLM等): 該当時のみ翻訳プロキシへ向ける環境変数を子プロセスに注入する。
  // 非選択時は process.env そのまま＝プロキシが落ちていても他モデルは完全に無影響。
  const proxyEnv = getProxyEnv(config, model)

  // プロキシ経由モデル(ローカルOllama等)は Anthropic のプロンプトキャッシュが効かず、ツール定義を
  // 毎ターン丸ごと再送・再処理する。ツール定義28個だけで入力の約7割(72,337文字/全100,160文字)を
  // 占めるため、小型モデルが実際には使えない周辺ツールを落として入力を約1/4(約7,100トークン)へ圧縮
  // する。狙いはコストでなく速度とコンテキスト寿命＝初回応答が約40秒→約13秒、会話に使える余裕が
  // 約5万→約7万トークンになる。Claude 側はキャッシュが効くので絞らない(この分岐に入らない)。
  const PROXY_DISALLOWED_DEFAULT = [
    'Agent', 'CronCreate', 'CronDelete', 'CronList', 'DesignSync',
    'EnterWorktree', 'ExitWorktree', 'ListAgents', 'Monitor', 'NotebookEdit',
    'PushNotification', 'ReportFindings', 'ScheduleWakeup', 'SendMessage',
    'Skill', 'TaskCreate', 'TaskGet', 'TaskList', 'TaskOutput', 'TaskStop',
    'TaskUpdate', 'WebSearch', 'Workflow',
  ]
  const disallowedTools = ['AskUserQuestion']
  if (proxyEnv) {
    disallowedTools.push(...(config.proxyDisallowedTools || PROXY_DISALLOWED_DEFAULT))
  }

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
    '--disallowed-tools', disallowedTools.join(','),
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
  proc.stdin.on('error', () => {})

  // 最初のメッセージ送信
  _sendMessage(proc, prompt, imageData)

  proc.stdout.on('data', data => {
    data.toString().split('\n').filter(l => l.trim()).forEach(line => {
      try {
        const parsed = JSON.parse(line)

        // control_response: interrupt/set_model等の応答。内部プロトコルなので
        // クライアントへbroadcastせず、対応する待機Promiseを解決するだけに留める。
        if (parsed.type === 'control_response') {
          const requestId = parsed.response?.request_id
          if (requestId && proc._controlWaiters && proc._controlWaiters.has(requestId)) {
            const resolve = proc._controlWaiters.get(requestId)
            proc._controlWaiters.delete(requestId)
            resolve(parsed.response)
          }
          return
        }

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
              // model/effort/thinking も渡す（このプロセスが現在実際に走っている設定＝最も正確な値）。
              // 渡し忘れると切断中に制限へ当たった場合、doResume再起動時にCLI既定モデルへ
              // 無言で落ちる（予約投稿のproject欠落と同型の不具合）。
              const resumePrompt = '続けてください'
              scheduleResume(sessionId, resetAt.toISOString(), resumePrompt, project, model, effort, thinking)
              console.log(`[rate-limit] auto-resume default-on registered sessionId=${sessionId} resetAt=${resetAt.toISOString()}`)
            } else {
              // resumeDefaultOn=false: 状態記録のみ（タイマーなし）
              scheduleResume(sessionId, resetAt.toISOString(), null, project, model, effort, thinking)
              console.log(`[rate-limit] saved resetAt=${resetAt.toISOString()}`)
            }
          }
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
  })

  proc.on('error', err => {
    s.process = null
    // 詳細はサーバーログへ。クライアントには内部パス等を漏らさない一般メッセージのみ
    console.error(`[spawn:error] sessionId=${sessionId} ${err.message}`)
    broadcast(sessionId, { type: 'error', message: 'Failed to start Claude process' })
  })
}

// stdin に user メッセージを JSON で送信。書き込みの成否をbooleanで返す
// （呼び出し元が「送信できたか」を見て broadcast/ログの要否を判断するため）。
function _sendMessage(proc, prompt, imageData) {
  if (!proc || !proc.stdin || proc.stdin.destroyed) return false

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
    return true
  } catch {
    return false
  }
}

// プロセス停止。
// 既定(force未指定): まず control_request(interrupt) でターンだけを中断する。ACKが来れば
// プロセスは生かしたまま返す（次のメッセージを即座に受け付けられる）。ACKが来ない/失敗した
// 場合のみ、従来どおり SIGTERM でプロセスごと止める。
// force指定時（サーバーのgraceful shutdown等）は割り込みを試さず即SIGTERM＝旧来の挙動を維持する
// （シャットダウン中に非同期ACK待ちで子プロセスを孤児化させないため）。
async function stopClaude(sessionId, opts = {}) {
  const s = getState(sessionId)
  if (!s.process) return false
  const proc = s.process

  if (opts.force) {
    proc.kill('SIGTERM')
    return true
  }

  const response = await sendControlMessage(proc, 'interrupt')
  if (response && response.subtype === 'success') {
    // ターンのみ中断。プロセスは生存＝s.processはそのまま。CLIが直後に出す result
    // イベントで stream.js の turning フラグ・/api/status の running が false へ落ちる。
    s.lastStillQueued = Array.isArray(response.response?.still_queued) ? response.response.still_queued : []
    // ターンが走っていなければ interrupt は安全なno-op＝中断すべきものが無い。この時に
    // マーカーを出すと、次に普通に完了したターンが「停止しました」と誤表示される（実測）。
    if (!s.turning) return true
    // 直後に来る result(error_during_execution) が「ユーザーが止めた結果」であることを
    // クライアントへ知らせる印。時刻ではなく順序で解釈させるためのマーカー（ログにも残るので
    // 再生時・他端末でも同じ解釈になる）。これが無いと、本物の実行時エラーまで
    // 「停止しました」と表示して失敗を隠してしまう。
    broadcast(sessionId, { type: 'interrupted', timestamp: new Date().toISOString() })
    return true
  }

  console.warn(`[stop] interrupt ACK not received sessionId=${sessionId} -> SIGTERM fallback`)
  proc.kill('SIGTERM')
  return true
}

// 実行中プロセスへのプロンプト注入（割り込み送信）。
// user_input の broadcast は _sendMessage() が実際に書き込めたことを確認してから行う
// （書き込み前に出すと、失敗時も画面にはユーザー発言があるのにClaudeのコンテキストには
// 届いていない、という食い違いが生じるため）。
function injectPrompt(sessionId, prompt, imageData) {
  const s = getState(sessionId)
  if (!s.process || !s.process.stdin || s.process.stdin.destroyed) return false
  s.lastStillQueued = null
  const sent = _sendMessage(s.process, prompt, imageData)
  if (sent) broadcast(sessionId, { type: 'user_input', text: prompt })
  return sent
}

// プロンプト配送口の一本化。呼び出し元(手動送信/自動再開/予約投稿/将来の経路)はすべて
// これ経由でセッションへプロンプトを届ける。責務:
//   1. プロセス生存確認 → 生きていれば注入 / 死んでいれば --resume で起動
//   2. project が未指定でも失敗させない。既定プロジェクトへのフォールバックは
//      startClaude 側（projects[project] || projects[先頭キー]）に委ねる。
//      config.projects が空（フォールバック先すら無い）の時だけ明示的に失敗させる。
//   3. 注入・起動に失敗したら system イベントを broadcast して必ず画面に出す（握りつぶし禁止）
//   4. 呼び出し元へ結果(injected/started/failed)を返す
// git pull は本関数の責務に含めない（既存の各呼び出し元の配置・条件をそのまま踏襲する）。
function deliverPrompt(sessionId, prompt, opts = {}) {
  const { imageData = null, project = null, model = null, effort = null, thinking = null, silent = false } = opts
  const s = getState(sessionId)

  if (s.process) {
    const injected = injectPrompt(sessionId, prompt, imageData)
    if (injected) return { status: 'injected' }
    // stdin不在・destroyed・書き込み例外のいずれでもここに来る。事後にジャーナルで
    // 追えるよう、画面通知(_notifyFailure)とは別にサーバーログへも残す。
    console.error(`[deliverPrompt] inject failed sessionId=${sessionId} reason=stdin unavailable or write failed`)
    _notifyFailure(sessionId, prompt, '実行中プロセスへの送信に失敗しました')
    return { status: 'failed', reason: '実行中プロセスへの送信に失敗しました' }
  }

  if (Object.keys(config.projects).length === 0) {
    console.error(`[deliverPrompt] config.projects is empty, cannot start sessionId=${sessionId}`)
    _notifyFailure(sessionId, prompt, 'プロジェクトが設定されていません')
    return { status: 'failed', reason: 'プロジェクトが設定されていません' }
  }

  const claudeSessionId = getClaudeSessionId(sessionId)
  try {
    startClaude(sessionId, prompt, model, project, claudeSessionId, effort, thinking, imageData)
    // user_input の broadcast は startClaude() が例外を投げずに起動できたことを確認してから行う
    // （失敗時に画面だけユーザー発言が残りClaudeのコンテキストには無い、という食い違いを避ける）。
    if (!silent) broadcast(sessionId, { type: 'user_input', text: prompt })
    return { status: 'started' }
  } catch (e) {
    console.error(`[deliverPrompt] startClaude threw sessionId=${sessionId} ${e.message}`)
    _notifyFailure(sessionId, prompt, e.message)
    return { status: 'failed', reason: e.message }
  }
}

// 配送失敗を画面へ必ず知らせる。自動再開・予約投稿のように「ユーザーが見ていない経路」
// でも気づけるよう system イベントを出す（握りつぶし禁止）。
function _notifyFailure(sessionId, prompt, reason) {
  const preview = prompt ? (prompt.length > 40 ? prompt.slice(0, 40) + '…' : prompt) : '(画像)'
  broadcast(sessionId, { type: 'system', text: `⚠ 送信できませんでした: ${reason} — ${preview}` })
}

module.exports = { startClaude, stopClaude, injectPrompt, deliverPrompt, sendControlMessage, gitPull }
