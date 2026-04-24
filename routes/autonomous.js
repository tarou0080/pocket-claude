const express = require('express')
const router = express.Router()
const { randomUUID } = require('crypto')
const fs = require('fs')
const path = require('path')
const { broadcastToSession } = require('../services/stream')
const { initProject, loadProgress: loadProgressService } = require('../services/autonomous')

const PROGRESS_FILE = path.join(__dirname, '..', 'autonomous-progress.json')

// 進捗ファイル読み込み
function loadProgress(projectId) {
  try {
    const data = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'))
    return data[projectId] || null
  } catch {
    return null
  }
}

// 進捗ファイル保存
function saveProgress(projectId, progress) {
  let data = {}
  try {
    data = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'))
  } catch {}
  data[projectId] = progress
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(data, null, 2))
}

// プロジェクト開始
router.post('/start', (req, res) => {
  const { goal, sessionId, managerModel, defaultWorkerModel } = req.body

  if (!goal || !sessionId) {
    return res.status(400).json({ error: 'goal and sessionId required' })
  }

  const progress = initProject(goal, sessionId, managerModel, defaultWorkerModel)

  res.json({
    projectId: progress.projectId,
    planFile: progress.planFile,
    progressFile: 'autonomous-progress.json',
    message: 'Phase 0（要件定義）を開始します',
    config: {
      managerModel: progress.managerSession.model,
      defaultWorkerModel: progress.defaultWorkerModel
    }
  })
})

// 進捗確認
router.get('/progress/:projectId', (req, res) => {
  const { projectId } = req.params
  const progress = loadProgress(projectId)

  if (!progress) {
    return res.status(404).json({ error: 'project not found' })
  }

  // タイムライン生成
  const timeline = progress.workerSessions.map(w => ({
    phase: w.phase,
    status: w.status,
    timestamp: w.completedAt || w.startedAt
  }))

  res.json({
    projectId: progress.projectId,
    currentPhase: progress.currentPhase,
    totalPhases: progress.totalPhases,
    status: progress.status,
    lastUpdate: progress.workerSessions.length > 0
      ? progress.workerSessions[progress.workerSessions.length - 1].startedAt
      : progress.startedAt,
    nextResume: null, // TODO: scheduler連携
    timeline
  })
})

// Worker起動
router.post('/spawn-worker', async (req, res) => {
  const { projectId, phase, model, instruction } = req.body

  if (!projectId || phase === undefined || !instruction) {
    return res.status(400).json({ error: 'projectId, phase, instruction required' })
  }

  const progress = loadProgress(projectId)
  if (!progress) {
    return res.status(404).json({ error: 'project not found' })
  }

  const workerSessionId = `w${phase}-${randomUUID().slice(0, 8)}`
  const workerModel = model || progress.defaultWorkerModel

  // 既存の /api/send を内部呼び出し（services/spawner.jsを直接使用）
  try {
    const { startClaude } = require('../services/spawner')
    const config = require('../config/index')
    const projectName = Object.keys(config.projects)[0]

    startClaude(workerSessionId, instruction, workerModel, projectName, null, null, null)

    // 進捗更新
    progress.workerSessions.push({
      phase,
      name: `Phase ${phase}`,
      sessionId: workerSessionId,
      model: workerModel,
      status: 'in_progress',
      startedAt: new Date().toISOString()
    })
    saveProgress(projectId, progress)

    res.json({
      workerSessionId,
      phase,
      model: workerModel,
      status: 'started',
      message: `Worker（${workerModel}）起動しました`
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Worker完了報告
router.post('/worker-complete', (req, res) => {
  const { projectId, workerSessionId, phase, status, summary, artifacts } = req.body

  if (!projectId || !workerSessionId || !phase) {
    return res.status(400).json({ error: 'projectId, workerSessionId, phase required' })
  }

  const progress = loadProgress(projectId)
  if (!progress) {
    return res.status(404).json({ error: 'project not found' })
  }

  // Worker情報更新
  const worker = progress.workerSessions.find(w => w.sessionId === workerSessionId)
  if (worker) {
    worker.status = status || 'completed'
    worker.completedAt = new Date().toISOString()
    worker.summary = summary
    worker.artifacts = artifacts
  }

  // 現在のPhase更新
  if (status === 'completed') {
    progress.currentPhase = phase + 1
  }

  saveProgress(projectId, progress)

  // Managerセッションに通知
  const managerSessionId = progress.managerSession.sessionId
  broadcastToSession(managerSessionId, {
    type: 'worker_complete',
    projectId,
    phase,
    workerSessionId,
    status: status || 'completed',
    summary,
    artifacts,
    timestamp: new Date().toISOString()
  })

  res.json({ message: 'Managerに報告しました' })
})

// Worker状態確認
router.get('/worker-status/:workerSessionId', (req, res) => {
  const { workerSessionId } = req.params

  // 全プロジェクトから該当Workerを検索
  let data = {}
  try {
    data = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'))
  } catch {
    return res.status(404).json({ error: 'worker not found' })
  }

  for (const progress of Object.values(data)) {
    const worker = progress.workerSessions.find(w => w.sessionId === workerSessionId)
    if (worker) {
      return res.json({
        workerSessionId: worker.sessionId,
        phase: worker.phase,
        model: worker.model,
        status: worker.status,
        lastActivity: worker.completedAt || worker.startedAt,
        progress: worker.summary || 'Processing...'
      })
    }
  }

  res.status(404).json({ error: 'worker not found' })
})

// チェックポイント応答
router.post('/checkpoint-response', (req, res) => {
  const { projectId, approved, feedback, nextPhaseModel } = req.body

  if (!projectId) {
    return res.status(400).json({ error: 'projectId required' })
  }

  const progress = loadProgress(projectId)
  if (!progress) {
    return res.status(404).json({ error: 'project not found' })
  }

  // チェックポイント記録
  progress.checkpoints.push({
    phase: progress.currentPhase,
    approved,
    feedback,
    nextPhaseModel,
    timestamp: new Date().toISOString()
  })

  saveProgress(projectId, progress)

  // Managerセッションに通知
  const managerSessionId = progress.managerSession.sessionId
  broadcastToSession(managerSessionId, {
    type: 'checkpoint_response',
    projectId,
    approved,
    feedback,
    nextPhaseModel,
    timestamp: new Date().toISOString()
  })

  res.json({
    ok: true,
    message: approved ? '次のPhaseに進みます' : 'フィードバックをManagerに送信しました'
  })
})

module.exports = router
