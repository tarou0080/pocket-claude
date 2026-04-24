const fs = require('fs')
const path = require('path')

const PROGRESS_FILE = path.join(__dirname, '..', 'autonomous-progress.json')
const REPORTS_DIR = '/home/johnadmin/reports'

// 自分が属するプロジェクトを見つける
function findMyProject(workerSessionId) {
  try {
    const data = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'))
    for (const [projectId, progress] of Object.entries(data)) {
      const worker = progress.workerSessions.find(w => w.sessionId === workerSessionId)
      if (worker) {
        return { projectId, progress, worker }
      }
    }
    return null
  } catch {
    return null
  }
}

// Planファイル読み込み
function readPlan(projectId) {
  try {
    const data = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'))
    const progress = data[projectId]
    if (!progress) return null

    const planPath = path.join(REPORTS_DIR, progress.planFile)
    return fs.readFileSync(planPath, 'utf8')
  } catch {
    return null
  }
}

// Autonomous-progress.json読み込み
function readProgress(projectId) {
  try {
    const data = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'))
    return data[projectId] || null
  } catch {
    return null
  }
}

// Worker完了報告
async function reportComplete(workerSessionId, summary, artifacts) {
  const result = findMyProject(workerSessionId)
  if (!result) throw new Error('Project not found')

  const { projectId, worker } = result

  // Managerに報告
  const fetch = (await import('node-fetch')).default
  const response = await fetch('http://localhost:3333/api/autonomous/worker-complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId,
      workerSessionId,
      phase: worker.phase,
      status: 'completed',
      summary,
      artifacts
    })
  })

  if (!response.ok) {
    throw new Error(`Failed to report completion: ${response.statusText}`)
  }

  return await response.json()
}

// Worker エラー報告
async function reportError(workerSessionId, error, retryCount) {
  const result = findMyProject(workerSessionId)
  if (!result) throw new Error('Project not found')

  const { projectId, worker } = result

  const fetch = (await import('node-fetch')).default
  const response = await fetch('http://localhost:3333/api/autonomous/worker-complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId,
      workerSessionId,
      phase: worker.phase,
      status: 'error',
      summary: `Error: ${error}`,
      retryCount
    })
  })

  if (!response.ok) {
    throw new Error(`Failed to report error: ${response.statusText}`)
  }

  return await response.json()
}

module.exports = {
  findMyProject,
  readPlan,
  readProgress,
  reportComplete,
  reportError
}
