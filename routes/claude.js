const express = require('express')
const fs = require('fs')
const path = require('path')
const router = express.Router()
const { stopClaude, deliverPrompt, sendControlMessage, gitPull } = require('../services/spawner')
const { getState, broadcast, logFile } = require('../services/stream')
const { scheduleResume, cancelResume, getSchedule } = require('../services/scheduler')
const { saveClaudeSessionId, saveSessionSettings } = require('../services/sessions')
const { UUID_RE } = require('../services/history')
const config = require('../config/index')

const sessionsDir = path.join(__dirname, '..', 'sessions')

// プロジェクト一覧
router.get('/projects', (_req, res) => {
  res.json(Object.keys(config.projects))
})

// 状態確認
router.get('/status', (req, res) => {
  const sessionId = req.query.session
  if (!sessionId) return res.status(400).json({ error: 'session required' })
  const s = getState(sessionId)
  const resp = { running: s.turning }
  // CLI側キュー(still_queued)は control_request(interrupt) の応答でのみ取得できる限定的な情報。
  // 常時ポーリングしてまで取りに行くコストには見合わないため、直近のinterrupt時点のスナップショットを
  // 参考情報として添えるだけに留める（サーバー真実源の照合対象を広げすぎない）。
  if (Array.isArray(s.lastStillQueued) && s.lastStillQueued.length) resp.cliStillQueued = s.lastStillQueued
  res.json(resp)
})

// プロンプト送信
router.post('/send', async (req, res) => {
  const { prompt, sessionId, project, model, effort, thinking, images } = req.body
  // images: [{ mediaType, data }] の配列（base64）
  const imageData = (Array.isArray(images) && images.length > 0) ? images : null
  if (!imageData && (!prompt || !prompt.trim())) return res.status(400).json({ error: 'prompt required' })
  // sessionId は未指定なら下で randomUUID() を採番する（既存挙動を維持）。
  // 指定がある場合のみ形式を検証する（history.js の読み出し経路と同じ規則を書き込み側にも適用）。
  if (sessionId && !UUID_RE.test(sessionId)) {
    return res.status(400).json({ error: 'invalid sessionId' })
  }

  const { randomUUID } = require('crypto')
  const actualSessionId = sessionId || randomUUID()
  const actualProject = project || Object.keys(config.projects)[0]

  const s = getState(actualSessionId)

  // アイドル中(ターン外)にモデルが変更された場合は、まず control_request(set_model) で
  // 常駐プロセスへ直接モデルを切り替える（会話文脈・プロセスとも継続、再起動なし）。
  // ACKが来ない/失敗した場合のみ、従来どおりプロセスを止めて --resume で新モデル再起動する。
  // ターン中は表示側でモデル選択をロックしているため、ここに来る変更は基本アイドル時のみ。
  if (s.process && !s.turning && (model || null) !== (s.model || null)) {
    const targetModel = model || 'default'
    console.log(`[send] model switch ${s.model || 'default'} → ${targetModel} sessionId=${actualSessionId} : trying set_model`)
    const response = await sendControlMessage(s.process, 'set_model', { model: targetModel })
    if (response && response.subtype === 'success') {
      s.model = model || null
      console.log(`[send] set_model succeeded sessionId=${actualSessionId}`)
    } else {
      console.warn(`[send] set_model failed/no-ack sessionId=${actualSessionId} response=${JSON.stringify(response)} -> fallback to kill+resume restart`)
      const oldProc = s.process
      // spawnerのcloseハンドラ(=s.process=null/doneブロードキャスト)を外す。
      // タイムアウト先行時に遅れて発火し、再起動後の新プロセスを誤って無効化するレースを防ぐ。
      oldProc.removeAllListeners('close')
      await new Promise(resolve => {
        oldProc.once('close', resolve)
        oldProc.kill('SIGTERM')
        setTimeout(resolve, 3000) // 終了が来ない場合の保険
      })
      if (s.process === oldProc) s.process = null // 未起動扱いに戻し、startClaude(--resume) へ進ませる
    }
  }

  // project/model/effort/thinking をセッションの属性として保存する。
  // 予約投稿・自動再開（レート制限）など、後からこれらの値を渡せない/渡し忘れうる
  // 呼び出し元がこのセッションへ配送する際に最後の設定へフォールバックできるようにする。
  saveSessionSettings(actualSessionId, {
    project: actualProject,
    model: model || null,
    effort: effort || null,
    thinking: thinking !== undefined ? thinking : null,
  })

  // git pull（プロセスが死んでいて新規起動する場合のみ。生存プロセスへの注入時は従来どおり行わない）
  if (!s.process) {
    const projectDir = config.projects[actualProject]
    if (projectDir) {
      const pulled = await gitPull(projectDir)
      if (pulled) broadcast(actualSessionId, { type: 'system', text: `git pull: ${pulled}` })
    }
  }

  const result = deliverPrompt(actualSessionId, prompt, {
    imageData,
    project: actualProject,
    model,
    effort: effort || null,
    thinking: thinking !== undefined ? thinking : null,
  })
  if (result.status === 'failed') {
    return res.status(502).json({
      ok: false,
      status: 'failed',
      reason: result.reason,
      sessionId: actualSessionId,
    })
  }
  res.json({
    ok: true,
    sessionId: actualSessionId,
    injected: result.status === 'injected',
    started: result.status === 'started',
  })
})

// 停止
router.post('/stop', async (req, res) => {
  const sessionId = req.body.session
  if (!sessionId) return res.status(400).json({ error: 'session required' })
  if (!UUID_RE.test(sessionId)) return res.status(400).json({ error: 'invalid sessionId' })
  const stopped = await stopClaude(sessionId)
  if (!stopped) return res.status(409).json({ error: 'not running' })
  res.json({ ok: true })
})

// セッション登録（履歴再開用）
router.post('/register-session', (req, res) => {
  const { pocketSessionId, claudeSessionId } = req.body
  if (!pocketSessionId || !claudeSessionId) return res.status(400).json({ error: 'pocketSessionId and claudeSessionId required' })
  // pocketSessionId は saveSessionMeta 経由でファイル名(パス)に使われ、claudeSessionId は
  // 保存後に services/history.js が再びファイル名(パス)として使う（getSessionEvents）。
  // どちらも書き込み/読み出しパスの材料になるため両方を検証する。
  if (!UUID_RE.test(pocketSessionId) || !UUID_RE.test(claudeSessionId)) {
    return res.status(400).json({ error: 'invalid sessionId' })
  }
  try {
    // saveClaudeSessionId は既存フィールド(project等)とマージする＝ここでの直接writeFileSync
    // をやめないと、先に保存済みの project が上書きで消える
    saveClaudeSessionId(pocketSessionId, claudeSessionId)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// セッションリセット
router.post('/reset', (req, res) => {
  const sessionId = req.body.session
  if (!sessionId) return res.status(400).json({ error: 'session required' })
  if (!UUID_RE.test(sessionId)) return res.status(400).json({ error: 'invalid sessionId' })
  const s = getState(sessionId)
  if (s.process) return res.status(409).json({ error: 'Claude is running.' })
  s.buffer = []
  fs.unlink(logFile(sessionId), () => {})
  fs.unlink(path.join(sessionsDir, `${sessionId}.json`), () => {})
  res.json({ ok: true, sessionId })
})

// 自動再開スケジュール登録
router.post('/schedule-resume/:sessionId', (req, res) => {
  const { sessionId } = req.params
  const { resetAt, prompt, project, model, effort, thinking } = req.body
  if (!sessionId || !resetAt) return res.status(400).json({ error: 'sessionId, resetAt required' })
  console.log(`[schedule-resume] POST sessionId=${sessionId} autoResume=${!!prompt} resetAt=${resetAt}`)
  scheduleResume(sessionId, resetAt, prompt, project, model, effort, thinking)
  // 計算後の実際のキック時刻(fireAt)を返し、クライアントがカードに表示できるようにする
  res.json(getSchedule(sessionId) || { ok: true })
})

// 自動再開スケジュールキャンセル
router.delete('/schedule-resume/:sessionId', (req, res) => {
  const { sessionId } = req.params
  console.log(`[schedule-resume] DELETE sessionId=${sessionId}`)
  cancelResume(sessionId)
  res.json({ ok: true })
})

// 自動再開スケジュール確認
router.get('/schedule-resume/:sessionId', (req, res) => {
  const { sessionId } = req.params
  const s = getSchedule(sessionId)
  console.log(`[schedule-resume] GET sessionId=${sessionId} → resetAt=${s?.resetAt || 'null'} autoResume=${s ? !!s.prompt : 'null'}`)
  res.json(s || { resetAt: null })
})

// フロントエンドからのデバッグログ受信
router.post('/client-log', (req, res) => {
  const { event, data } = req.body || {}
  if (event) console.log(`[client] ${event} ${data ? JSON.stringify(data) : ''}`)
  res.json({ ok: true })
})

module.exports = router
