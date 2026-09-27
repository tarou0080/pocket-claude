const express = require('express')
const fs = require('fs')
const path = require('path')
const router = express.Router()
const { stopClaude, deliverPrompt, sendControlMessage, gitPull } = require('../services/spawner')
const { getState, broadcast, logFile } = require('../services/stream')
const { scheduleResume, cancelResume, getSchedule } = require('../services/scheduler')
const { readSessionFacts, projectFromCwd, sessionExists } = require('../services/session-facts')
const { sessionModel } = require('../services/models')
const { findClaudePid } = require('../services/external-process')
const { UUID_RE } = require('../services/history')
const { proxyRouteChanged } = require('../services/proxy-route')
const { validAutoCompactWindow } = require('../services/auto-compact')
const config = require('../config/index')

// プロジェクト一覧
router.get('/projects', (_req, res) => {
  res.json(Object.keys(config.projects))
})

// 状態確認
router.get('/status', (req, res) => {
  const raw = req.query.session
  if (!raw) return res.status(400).json({ error: 'session required' })
  if (!UUID_RE.test(raw)) return res.status(400).json({ error: 'invalid sessionId' })
  const sessionId = raw
  const s = getState(sessionId)
  const externalPid = !s.process ? findClaudePid(sessionId) : null
  const resp = { running: s.turning || (!!externalPid), external: !!externalPid }
  if (Array.isArray(s.lastStillQueued) && s.lastStillQueued.length) resp.cliStillQueued = s.lastStillQueued
  res.json(resp)
})

// プロンプト送信
router.post('/send', async (req, res) => {
  const { prompt, sessionId, project, model, effort, thinking, images } = req.body
  const imageData = (Array.isArray(images) && images.length > 0) ? images : null
  if (!imageData && (!prompt || !prompt.trim())) return res.status(400).json({ error: 'prompt required' })
  if (sessionId && !UUID_RE.test(sessionId)) {
    return res.status(400).json({ error: 'invalid sessionId' })
  }

  if (model && Array.isArray(config.models) && config.models.length > 0) {
    const allowed = config.models.some(m => m.value === model)
    if (!allowed) return res.status(400).json({ error: 'invalid model' })
  }

  const { randomUUID } = require('crypto')
  const actualSessionId = sessionId || randomUUID()
  const actualProject = project || Object.keys(config.projects)[0]

  const s = getState(actualSessionId)

  // 外部プロセスが走っている場合は送信しない（pocketが管理していないため）。
  if (!s.process && findClaudePid(actualSessionId)) {
    return res.status(409).json({ error: 'external process running' })
  }

  let restart = false
  if (s.process && !s.turning && model !== undefined && (model || null) !== (s.model || null)) {
    const proxyRouteChanges = proxyRouteChanged(config, s.model, model)

    let switched = false
    if (!proxyRouteChanges) {
      const targetModel = model || 'default'
      console.log(`[send] model switch ${s.model || 'default'} → ${targetModel} sessionId=${actualSessionId} : trying set_model`)
      const response = await sendControlMessage(s.process, 'set_model', { model: targetModel })
      if (response && response.subtype === 'success') {
        s.model = model || null
        s.learnModel = true
        switched = true
        console.log(`[send] set_model succeeded sessionId=${actualSessionId}`)
      } else {
        console.warn(`[send] set_model failed/no-ack sessionId=${actualSessionId} response=${JSON.stringify(response)} -> fallback to kill+resume restart`)
      }
    } else {
      console.log(`[send] model switch ${s.model || 'default'} → ${model || 'default'} sessionId=${actualSessionId} : proxy route changes, skipping set_model -> kill+resume restart`)
    }

    if (!switched) restart = true
  }

  // 自動圧縮の開始サイズは CLI が起動時にしか読まない（制御リクエスト apply_flag_settings は
  // ACK するが走行中に効かない＝実測）。待機中のプロセスが今の設定と違う値で起動していれば、
  // その会話だけ起動し直して次のターンから効かせる（保存時に全会話を巻き込まない）。
  const wantAutoCompact = validAutoCompactWindow(config.autoCompactWindow)
  if (s.process && !s.turning && !restart && (s.autoCompactWindow ?? null) !== wantAutoCompact) {
    console.log(`[send] autoCompactWindow ${s.autoCompactWindow ?? 'default'} → ${wantAutoCompact ?? 'default'} sessionId=${actualSessionId} : kill+resume restart`)
    restart = true
  }

  if (restart) {
    const oldProc = s.process
    oldProc.removeAllListeners('close')
    await new Promise(resolve => {
      oldProc.once('close', resolve)
      oldProc.kill('SIGTERM')
      setTimeout(resolve, 3000)
    })
    if (s.process === oldProc) s.process = null
  }

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
    // ターン実行中に送った＝CLI の待ち行列に入り、モデルが読んだ時点で会話に現れる
    queued: !!result.queued,
  })
})

// 停止
router.post('/stop', async (req, res) => {
  const raw = req.body.session
  if (!raw) return res.status(400).json({ error: 'session required' })
  if (!UUID_RE.test(raw)) return res.status(400).json({ error: 'invalid sessionId' })
  const sessionId = raw
  const s = getState(sessionId)
  if (!s.process) return res.status(409).json({ error: 'not running' })
  const stopped = await stopClaude(sessionId)
  if (!stopped) return res.status(409).json({ error: 'not running' })
  res.json({ ok: true })
})

// セッションの最終使用設定を取得（履歴からの復帰時に使う）
router.get('/session-settings/:sessionId', (req, res) => {
  const { sessionId } = req.params
  if (!UUID_RE.test(sessionId)) return res.status(400).json({ error: 'invalid sessionId' })
  if (!sessionExists(sessionId)) return res.json({ project: null, model: null, modelResolved: null, effort: null })
  const facts = readSessionFacts(sessionId)
  res.json({
    project: projectFromCwd(facts.cwd, config.projects),
    model: sessionModel(sessionId, facts),
    modelResolved: facts.model,
    effort: facts.effort,
  })
})

// セッションリセット
router.post('/reset', (req, res) => {
  const raw = req.body.session
  if (!raw) return res.status(400).json({ error: 'session required' })
  if (!UUID_RE.test(raw)) return res.status(400).json({ error: 'invalid sessionId' })
  const sessionId = raw
  const s = getState(sessionId)
  if (s.process) return res.status(409).json({ error: 'Claude is running.' })
  if (findClaudePid(sessionId)) return res.status(409).json({ error: 'external process running' })
  s.buffer = []
  fs.unlink(logFile(sessionId), () => {})
  res.json({ ok: true, sessionId })
})

// 自動再開スケジュール登録
router.post('/schedule-resume/:sessionId', (req, res) => {
  if (!UUID_RE.test(req.params.sessionId)) return res.status(400).json({ error: 'invalid sessionId' })
  const sessionId = req.params.sessionId
  const { resetAt, prompt, project, model, effort, thinking } = req.body
  if (!sessionId || !resetAt) return res.status(400).json({ error: 'sessionId, resetAt required' })
  console.log(`[schedule-resume] POST sessionId=${sessionId} autoResume=${!!prompt} resetAt=${resetAt}`)
  scheduleResume(sessionId, resetAt, prompt, project, model, effort, thinking)
  res.json(getSchedule(sessionId) || { ok: true })
})

// 自動再開スケジュールキャンセル
router.delete('/schedule-resume/:sessionId', (req, res) => {
  if (!UUID_RE.test(req.params.sessionId)) return res.status(400).json({ error: 'invalid sessionId' })
  const sessionId = req.params.sessionId
  console.log(`[schedule-resume] DELETE sessionId=${sessionId}`)
  cancelResume(sessionId)
  res.json({ ok: true })
})

// 自動再開スケジュール確認
router.get('/schedule-resume/:sessionId', (req, res) => {
  if (!UUID_RE.test(req.params.sessionId)) return res.status(400).json({ error: 'invalid sessionId' })
  const sessionId = req.params.sessionId
  const s = getSchedule(sessionId)
  console.log(`[schedule-resume] GET sessionId=${sessionId} → resetAt=${s?.resetAt || 'null'} autoResume=${s ? !!s.prompt : 'null'}`)
  res.json(s || { resetAt: null })
})

// フロントエンドからのデバッグログ受信
const CLIENT_LOG_MAX_BYTES = 64 * 1024
router.post('/client-log', (req, res) => {
  const bodyStr = JSON.stringify(req.body || {})
  if (Buffer.byteLength(bodyStr, 'utf8') > CLIENT_LOG_MAX_BYTES) {
    return res.status(400).json({ error: 'payload too large' })
  }
  const { event, data } = req.body || {}
  if (event) console.log(`[client] ${event} ${data ? JSON.stringify(data) : ''}`)
  res.json({ ok: true })
})

module.exports = router
