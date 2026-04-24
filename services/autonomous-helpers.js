// Claudeが自律開発モードで使うヘルパー関数
const { initProject, spawnWorker, loadProgress, updatePlan, completeProject } = require('./autonomous')
const { broadcastToSession } = require('./stream')

/**
 * 自律開発プロジェクトを開始
 * @param {string} goal - プロジェクトのゴール
 * @param {string} managerSessionId - Managerセッション ID
 * @param {string} managerModel - Managerモデル（opus/sonnet）
 * @param {string} defaultWorkerModel - デフォルトWorkerモデル（sonnet/haiku/opus）
 * @returns {object} プロジェクト情報
 */
function startAutonomousProject(goal, managerSessionId, managerModel = 'opus', defaultWorkerModel = 'sonnet') {
  const progress = initProject(goal, managerSessionId, managerModel, defaultWorkerModel)

  // Managerセッションに通知
  broadcastToSession(managerSessionId, {
    type: 'autonomous_project_started',
    projectId: progress.projectId,
    planFile: progress.planFile,
    goal: goal,
    timestamp: new Date().toISOString()
  })

  return {
    projectId: progress.projectId,
    planFile: progress.planFile,
    message: `自律開発プロジェクト「${goal}」を開始しました。planファイル: ${progress.planFile}`
  }
}

/**
 * Workerを起動してPhaseを実行
 * @param {string} projectId - プロジェクトID
 * @param {number} phase - Phase番号
 * @param {string} instruction - Workerへの指示
 * @param {string} model - Workerモデル（省略時はdefaultWorkerModel）
 * @returns {object} Worker情報
 */
function startPhaseWorker(projectId, phase, instruction, model = null) {
  const { workerSessionId, workerModel } = spawnWorker(projectId, phase, model, instruction)

  const progress = loadProgress(projectId)
  const managerSessionId = progress.managerSession.sessionId

  // Managerセッションに通知
  broadcastToSession(managerSessionId, {
    type: 'phase_worker_started',
    projectId,
    phase,
    workerSessionId,
    workerModel,
    timestamp: new Date().toISOString()
  })

  return {
    workerSessionId,
    workerModel,
    message: `Phase ${phase} のWorker（${workerModel}）を起動しました（セッション: ${workerSessionId}）`
  }
}

/**
 * Phase結果をplanファイルに記録
 * @param {string} projectId - プロジェクトID
 * @param {number} phase - Phase番号
 * @param {string} result - Phase結果の内容
 */
function recordPhaseResult(projectId, phase, result) {
  updatePlan(projectId, phase, result)

  const progress = loadProgress(projectId)
  const managerSessionId = progress.managerSession.sessionId

  broadcastToSession(managerSessionId, {
    type: 'phase_result_recorded',
    projectId,
    phase,
    timestamp: new Date().toISOString()
  })

  return {
    message: `Phase ${phase} の結果をplanファイルに記録しました`
  }
}

/**
 * プロジェクト完了
 * @param {string} projectId - プロジェクトID
 */
function finishProject(projectId) {
  const progress = completeProject(projectId)
  const managerSessionId = progress.managerSession.sessionId

  broadcastToSession(managerSessionId, {
    type: 'autonomous_project_completed',
    projectId,
    completedAt: progress.completedAt,
    timestamp: new Date().toISOString()
  })

  return {
    message: `プロジェクト「${progress.goal}」が完了しました✅`,
    planFile: progress.planFile
  }
}

/**
 * プロジェクト進捗を取得
 * @param {string} projectId - プロジェクトID
 * @returns {object} 進捗情報
 */
function getProjectProgress(projectId) {
  const progress = loadProgress(projectId)
  if (!progress) return null

  const completedPhases = progress.workerSessions.filter(w => w.status === 'completed').length
  const inProgressPhases = progress.workerSessions.filter(w => w.status === 'in_progress').length

  return {
    projectId: progress.projectId,
    goal: progress.goal,
    currentPhase: progress.currentPhase,
    completedPhases,
    inProgressPhases,
    status: progress.status,
    planFile: progress.planFile,
    workerSessions: progress.workerSessions
  }
}

/**
 * Worker完了を待機（ポーリング）
 * @param {string} projectId - プロジェクトID
 * @param {string} workerSessionId - WorkerセッションID
 * @param {number} timeout - タイムアウト（ミリ秒）
 * @returns {Promise<object>} Worker完了情報
 */
function waitForWorkerCompletion(projectId, workerSessionId, timeout = 300000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now()

    const checkInterval = setInterval(() => {
      const progress = loadProgress(projectId)
      if (!progress) {
        clearInterval(checkInterval)
        return reject(new Error('Project not found'))
      }

      const worker = progress.workerSessions.find(w => w.sessionId === workerSessionId)
      if (!worker) {
        clearInterval(checkInterval)
        return reject(new Error('Worker not found'))
      }

      if (worker.status === 'completed' || worker.status === 'error') {
        clearInterval(checkInterval)
        return resolve({
          status: worker.status,
          summary: worker.summary,
          artifacts: worker.artifacts,
          completedAt: worker.completedAt
        })
      }

      if (Date.now() - startTime > timeout) {
        clearInterval(checkInterval)
        return reject(new Error('Worker completion timeout'))
      }
    }, 2000) // 2秒ごとにチェック
  })
}

module.exports = {
  startAutonomousProject,
  startPhaseWorker,
  recordPhaseResult,
  finishProject,
  getProjectProgress,
  waitForWorkerCompletion
}
