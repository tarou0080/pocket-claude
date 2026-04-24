const express = require('express')
const router = express.Router()
const { broadcastToSession } = require('../services/stream')
const {
  initProject,
  loadProgress,
  loadAllProgress,
  spawnWorker,
  completeWorker,
  recordCheckpoint
} = require('../services/autonomous')

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
    nextResume: null,
    timeline
  })
})

// Worker起動
router.post('/spawn-worker', (req, res) => {
  const { projectId, phase, model, instruction } = req.body

  if (!projectId || phase === undefined || !instruction) {
    return res.status(400).json({ error: 'projectId, phase, instruction required' })
  }

  if (!loadProgress(projectId)) {
    return res.status(404).json({ error: 'project not found' })
  }

  try {
    const { workerSessionId, workerModel } = spawnWorker(projectId, phase, model, instruction)

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

  if (!projectId || !workerSessionId || phase === undefined) {
    return res.status(400).json({ error: 'projectId, workerSessionId, phase required' })
  }

  try {
    const progress = completeWorker(projectId, workerSessionId, status, summary, artifacts)

    broadcastToSession(progress.managerSession.sessionId, {
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
  } catch (error) {
    res.status(404).json({ error: error.message })
  }
})

// Worker状態確認
router.get('/worker-status/:workerSessionId', (req, res) => {
  const { workerSessionId } = req.params
  const data = loadAllProgress()

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

  const existing = loadProgress(projectId)
  if (!existing) {
    return res.status(404).json({ error: 'project not found' })
  }

  try {
    const progress = recordCheckpoint(projectId, existing.currentPhase, approved, feedback, nextPhaseModel)

    broadcastToSession(progress.managerSession.sessionId, {
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
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

module.exports = router
