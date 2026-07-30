const fs = require('fs')
const path = require('path')
const { randomUUID } = require('crypto')
const config = require('../config/index')
const { getSessionProject } = require('./sessions')

const POSTS_FILE = path.join(__dirname, '..', 'scheduled-posts.json')

// id -> { id, scheduledAt, prompt, sessionId, project, model, effort, thinking,
//         createdAt, status, failedReason, executedAt, timerId }
// status: 'pending' | 'running' | 'failed'
// 成功した予約はレコードごと削除する（従来どおり一覧から消える）。
// failed は自動掃除しない。ユーザーが編集(再スケジュール)/再送/削除するまで残す。
const posts = new Map()

// project 解決の優先順位: 明示指定 → セッションに紐づく保存値 → 既定プロジェクト。
// 保存済みの project:null レコード（旧バグの副作用）もここで救済される。
function resolveProject(explicitProject, sessionId) {
  return explicitProject || getSessionProject(sessionId) || Object.keys(config.projects)[0] || null
}

function savePosts() {
  const data = {}
  posts.forEach((p, id) => {
    data[id] = {
      id: p.id,
      scheduledAt: p.scheduledAt,
      prompt: p.prompt,
      sessionId: p.sessionId,
      project: p.project,
      model: p.model,
      effort: p.effort,
      thinking: p.thinking,
      createdAt: p.createdAt,
      status: p.status,
      failedReason: p.failedReason || null,
      executedAt: p.executedAt || null,
    }
  })
  try { fs.writeFileSync(POSTS_FILE, JSON.stringify(data, null, 2)) } catch {}
}

async function executePost(id) {
  const p = posts.get(id)
  if (!p) return

  const { broadcast } = require('./stream')
  const { deliverPrompt, gitPull } = require('./spawner')

  // project は実行時にも再解決する（作成時点で null のまま保存された旧レコードの救済含む）
  const resolvedProject = resolveProject(p.project, p.sessionId)
  p.project = resolvedProject
  p.status = 'running'
  savePosts()

  const projectDir = config.projects[resolvedProject]
  if (projectDir) {
    const pulled = await gitPull(projectDir)
    if (pulled) broadcast(p.sessionId, { type: 'system', text: `git pull: ${pulled}` })
  }

  // 生存確認→注入/--resume起動。失敗時の system イベント broadcast は deliverPrompt が担う。
  const result = deliverPrompt(p.sessionId, p.prompt, { project: resolvedProject, model: p.model, effort: p.effort, thinking: p.thinking })
  console.log(`[scheduled-posts] deliverPrompt result=${result.status} id=${id}`)

  if (result.status === 'injected' || result.status === 'started') {
    broadcast(p.sessionId, { type: 'system', text: '🕐 予約投稿を実行しました' })
    posts.delete(id)
    savePosts()
  } else {
    const reason = result.reason || '配送に失敗しました'
    p.status = 'failed'
    p.failedReason = reason
    p.executedAt = new Date().toISOString()
    savePosts()
    broadcast(p.sessionId, { type: 'system', text: `⚠ 予約投稿を送信できませんでした: ${reason}` })
  }
}

function createPost({ scheduledAt, prompt, sessionId, project, model, effort, thinking }) {
  const id = randomUUID()
  const resolvedProject = resolveProject(project, sessionId)
  const delay = Math.max(0, new Date(scheduledAt).getTime() - Date.now())
  const timerId = setTimeout(() => executePost(id), delay)

  posts.set(id, {
    id,
    scheduledAt,
    prompt,
    sessionId,
    project: resolvedProject,
    model: model || null,
    effort: effort || null,
    thinking: thinking || null,
    createdAt: new Date().toISOString(),
    status: 'pending',
    failedReason: null,
    executedAt: null,
    timerId
  })
  savePosts()
  return id
}

// scheduledAt/prompt の更新。failed だった場合は pending へ復帰させて再スケジュールする。
function updatePost(id, { scheduledAt, prompt }) {
  const p = posts.get(id)
  if (!p) return false

  clearTimeout(p.timerId)

  const delay = Math.max(0, new Date(scheduledAt).getTime() - Date.now())
  const timerId = setTimeout(() => executePost(id), delay)

  p.scheduledAt = scheduledAt
  p.prompt = prompt
  p.timerId = timerId
  p.status = 'pending'
  p.failedReason = null
  p.executedAt = null

  savePosts()
  return true
}

function deletePost(id) {
  const p = posts.get(id)
  if (!p) return false
  clearTimeout(p.timerId)
  posts.delete(id)
  savePosts()
  return true
}

// そのレコードの内容で即時配送する。executePost と処理を共有する（二重化しない）。
// pending/failed どちらの状態からでも呼べる。既存タイマーがあればキャンセルしてから実行。
async function resendPost(id) {
  const p = posts.get(id)
  if (!p) return false
  clearTimeout(p.timerId)
  p.timerId = null
  await executePost(id)
  return true
}

function getPost(id) {
  const p = posts.get(id)
  if (!p) return null
  return {
    id: p.id,
    scheduledAt: p.scheduledAt,
    prompt: p.prompt,
    sessionId: p.sessionId,
    project: p.project,
    model: p.model,
    effort: p.effort,
    thinking: p.thinking,
    createdAt: p.createdAt,
    status: p.status,
    failedReason: p.failedReason || null,
    executedAt: p.executedAt || null,
  }
}

function getAllPosts() {
  const result = []
  posts.forEach(p => {
    result.push({
      id: p.id,
      scheduledAt: p.scheduledAt,
      prompt: p.prompt,
      sessionId: p.sessionId,
      project: p.project,
      model: p.model,
      effort: p.effort,
      thinking: p.thinking,
      createdAt: p.createdAt,
      status: p.status,
      failedReason: p.failedReason || null,
      executedAt: p.executedAt || null,
    })
  })
  return result
}

function getPostsBySession(sessionId) {
  return getAllPosts().filter(p => p.sessionId === sessionId)
}

// 起動時ロード。サービス停止中に時刻を過ぎた pending、実行中に中断された running は
// 自動実行せず failed として残す（黙って消さない・黙って実行もしない）。
function loadPosts() {
  try {
    const data = JSON.parse(fs.readFileSync(POSTS_FILE, 'utf8'))
    const now = Date.now()
    for (const [id, p] of Object.entries(data)) {
      const status = p.status || 'pending' // 旧形式互換（statusフィールド無し = pending扱い）

      if (status === 'running') {
        posts.set(id, { ...p, status: 'failed', failedReason: '実行中に中断されました', executedAt: new Date().toISOString(), timerId: null })
        continue
      }

      if (status === 'failed') {
        posts.set(id, { ...p, timerId: null })
        continue
      }

      // pending
      const scheduledTime = new Date(p.scheduledAt).getTime()
      if (scheduledTime > now) {
        const delay = scheduledTime - now
        const timerId = setTimeout(() => executePost(id), delay)
        posts.set(id, { ...p, status: 'pending', timerId })
      } else {
        posts.set(id, { ...p, status: 'failed', failedReason: 'サービス停止中に予約時刻を過ぎました', executedAt: new Date().toISOString(), timerId: null })
      }
    }
    savePosts()
    if (posts.size > 0) {
      console.log(`[scheduled-posts] Loaded ${posts.size} post(s)`)
    }
  } catch {}
}

module.exports = {
  createPost,
  updatePost,
  deletePost,
  resendPost,
  getPost,
  getAllPosts,
  getPostsBySession,
  loadPosts
}
