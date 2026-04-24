const fs = require('fs')
const path = require('path')
const { randomUUID } = require('crypto')

const PROGRESS_FILE = path.join(__dirname, '..', 'autonomous-progress.json')
const REPORTS_DIR = '/home/johnadmin/reports'

// 進捗ファイル読み込み
function loadProgress(projectId) {
  try {
    const data = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'))
    return data[projectId] || null
  } catch {
    return null
  }
}

// 全プロジェクト読み込み
function loadAllProgress() {
  try {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'))
  } catch {
    return {}
  }
}

// 進捗ファイル保存
function saveProgress(projectId, progress) {
  let data = loadAllProgress()
  data[projectId] = progress
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(data, null, 2))
}

// プロジェクト初期化
function initProject(goal, managerSessionId, managerModel, defaultWorkerModel) {
  const timestamp = Date.now()
  const projectId = `auto-${timestamp}`
  const planFile = `plan_${projectId}.md`

  const progress = {
    projectId,
    goal,
    planFile,
    startedAt: new Date().toISOString(),
    currentPhase: 0,
    totalPhases: 0,
    status: 'in_progress',
    managerSession: {
      sessionId: managerSessionId,
      model: managerModel || 'opus'
    },
    defaultWorkerModel: defaultWorkerModel || 'sonnet',
    workerSessions: [],
    checkpoints: []
  }

  saveProgress(projectId, progress)

  // plan_*.md初期化
  const planPath = path.join(REPORTS_DIR, planFile)
  const initialPlan = `<!-- tags: autonomous, ${projectId}, 自律開発 -->
# ${goal}

**プロジェクトID**: ${projectId}
**開始日**: ${new Date().toISOString().split('T')[0]}
**ステータス**: Phase 0（要件定義中）

## 要件定義（Phase 0）

（Managerがここに要件を記載）

---

## Phase分割

（Phase 1以降の計画をManagerが追記）

---

## 作業履歴

### ${new Date().toISOString()}
- プロジェクト開始
`

  try {
    fs.writeFileSync(planPath, initialPlan)
  } catch (err) {
    console.error(`[autonomous] Failed to create plan file: ${err.message}`)
  }

  return progress
}

// Planファイル更新
function updatePlan(projectId, phaseNumber, content) {
  const progress = loadProgress(projectId)
  if (!progress) throw new Error('Project not found')

  const planPath = path.join(REPORTS_DIR, progress.planFile)

  try {
    let plan = fs.readFileSync(planPath, 'utf8')

    // Phase結果を追記
    const timestamp = new Date().toISOString()
    const phaseSection = `\n## Phase ${phaseNumber}結果（${timestamp}）\n\n${content}\n`

    // "作業履歴"の前に挿入
    if (plan.includes('## 作業履歴')) {
      plan = plan.replace('## 作業履歴', phaseSection + '\n## 作業履歴')
    } else {
      plan += phaseSection
    }

    fs.writeFileSync(planPath, plan)
  } catch (err) {
    console.error(`[autonomous] Failed to update plan: ${err.message}`)
  }
}

// Worker起動
async function spawnWorker(projectId, phase, model, instruction) {
  const progress = loadProgress(projectId)
  if (!progress) throw new Error('Project not found')

  const workerSessionId = `w${phase}-${randomUUID().slice(0, 8)}`
  const workerModel = model || progress.defaultWorkerModel

  // 既存の /api/send を内部呼び出し
  const fetch = (await import('node-fetch')).default
  const response = await fetch('http://localhost:3333/api/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: workerSessionId,
      prompt: instruction,
      model: workerModel,
      project: Object.keys(require('../config/index').projects)[0]
    })
  })

  if (!response.ok) {
    throw new Error(`Failed to start worker: ${response.statusText}`)
  }

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

  return { workerSessionId, workerModel }
}

// Worker完了処理
function completeWorker(projectId, workerSessionId, status, summary, artifacts) {
  const progress = loadProgress(projectId)
  if (!progress) throw new Error('Project not found')

  const worker = progress.workerSessions.find(w => w.sessionId === workerSessionId)
  if (!worker) throw new Error('Worker not found')

  worker.status = status || 'completed'
  worker.completedAt = new Date().toISOString()
  worker.summary = summary
  worker.artifacts = artifacts

  if (status === 'completed') {
    progress.currentPhase = worker.phase + 1
  }

  saveProgress(projectId, progress)

  return progress
}

// チェックポイント記録
function recordCheckpoint(projectId, phase, approved, feedback, nextPhaseModel) {
  const progress = loadProgress(projectId)
  if (!progress) throw new Error('Project not found')

  progress.checkpoints.push({
    phase,
    approved,
    feedback,
    nextPhaseModel,
    timestamp: new Date().toISOString()
  })

  saveProgress(projectId, progress)

  return progress
}

// プロジェクト完了
function completeProject(projectId) {
  const progress = loadProgress(projectId)
  if (!progress) throw new Error('Project not found')

  progress.status = 'completed'
  progress.completedAt = new Date().toISOString()

  saveProgress(projectId, progress)

  return progress
}

module.exports = {
  loadProgress,
  loadAllProgress,
  saveProgress,
  initProject,
  updatePlan,
  spawnWorker,
  completeWorker,
  recordCheckpoint,
  completeProject
}
