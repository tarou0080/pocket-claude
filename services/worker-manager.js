const fs = require('fs')
const path = require('path')
const config = require('../config/index')

const PROGRESS_FILE = path.join(__dirname, '..', 'autonomous-progress.json')
const PORT = parseInt(process.env.PORT || config.port || 3333, 10)
const PLANS_DIR = path.join(__dirname, '..', 'autonomous-plans')

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

    const planPath = path.join(PLANS_DIR, progress.planFile)
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
function reportComplete(workerSessionId, summary, artifacts) {
  const result = findMyProject(workerSessionId)
  if (!result) throw new Error('Project not found')

  const { projectId, worker } = result

  // Managerに報告（内部HTTP呼び出し）
  const http = require('http')
  const postData = JSON.stringify({
    projectId,
    workerSessionId,
    phase: worker.phase,
    status: 'completed',
    summary,
    artifacts
  })

  const options = {
    hostname: 'localhost',
    port: PORT,
    path: '/api/autonomous/worker-complete',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  }

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data))
        } else {
          reject(new Error(`Failed to report completion: ${res.statusCode}`))
        }
      })
    })
    req.on('error', reject)
    req.write(postData)
    req.end()
  })
}

// Worker エラー報告
function reportError(workerSessionId, error, retryCount) {
  const result = findMyProject(workerSessionId)
  if (!result) throw new Error('Project not found')

  const { projectId, worker } = result

  const http = require('http')
  const postData = JSON.stringify({
    projectId,
    workerSessionId,
    phase: worker.phase,
    status: 'error',
    summary: `Error: ${error}`,
    retryCount
  })

  const options = {
    hostname: 'localhost',
    port: PORT,
    path: '/api/autonomous/worker-complete',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  }

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data))
        } else {
          reject(new Error(`Failed to report error: ${res.statusCode}`))
        }
      })
    })
    req.on('error', reject)
    req.write(postData)
    req.end()
  })
}

module.exports = {
  findMyProject,
  readPlan,
  readProgress,
  reportComplete,
  reportError
}
