const fs = require('fs')
const path = require('path')
const { randomUUID } = require('crypto')

const POSTS_FILE = path.join(__dirname, '..', 'scheduled-posts.json')
const sessionsDir = path.join(__dirname, '..', 'sessions')

// id -> { id, scheduledAt, prompt, sessionId, project, model, effort, thinking, createdAt, timerId }
const posts = new Map()

function getClaudeSessionId(sessionId) {
  try {
    return JSON.parse(fs.readFileSync(path.join(sessionsDir, `${sessionId}.json`), 'utf8')).claudeSessionId || null
  } catch { return null }
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
      createdAt: p.createdAt
    }
  })
  try { fs.writeFileSync(POSTS_FILE, JSON.stringify(data, null, 2)) } catch {}
}

async function executePost(id) {
  const p = posts.get(id)
  if (!p) return
  posts.delete(id)
  savePosts()

  const { getState, broadcast } = require('./stream')
  const { startClaude, injectPrompt, gitPull } = require('./spawner')
  const config = require('../config/index')

  const state = getState(p.sessionId)
  const claudeSessionId = getClaudeSessionId(p.sessionId)
  const projectDir = config.projects[p.project]

  if (projectDir) {
    const pulled = await gitPull(projectDir)
    if (pulled) broadcast(p.sessionId, { type: 'system', text: `git pull: ${pulled}` })
  }

  broadcast(p.sessionId, { type: 'system', text: '🕐 予約投稿を実行しました' })

  if (state.process) {
    injectPrompt(p.sessionId, p.prompt)
  } else {
    broadcast(p.sessionId, { type: 'user_input', text: p.prompt })
    startClaude(p.sessionId, p.prompt, p.model, p.project, claudeSessionId, p.effort, p.thinking)
  }
}

function createPost({ scheduledAt, prompt, sessionId, project, model, effort, thinking }) {
  const id = randomUUID()
  const delay = Math.max(0, new Date(scheduledAt).getTime() - Date.now())
  const timerId = setTimeout(() => executePost(id), delay)

  posts.set(id, {
    id,
    scheduledAt,
    prompt,
    sessionId,
    project: project || null,
    model: model || null,
    effort: effort || null,
    thinking: thinking || null,
    createdAt: new Date().toISOString(),
    timerId
  })
  savePosts()
  return id
}

function updatePost(id, { scheduledAt, prompt }) {
  const p = posts.get(id)
  if (!p) return false

  // 既存のtimerをクリア
  clearTimeout(p.timerId)

  // 新しい時刻・内容で再設定
  const delay = Math.max(0, new Date(scheduledAt).getTime() - Date.now())
  const timerId = setTimeout(() => executePost(id), delay)

  p.scheduledAt = scheduledAt
  p.prompt = prompt
  p.timerId = timerId

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
    createdAt: p.createdAt
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
      createdAt: p.createdAt
    })
  })
  return result
}

function getPostsBySession(sessionId) {
  return getAllPosts().filter(p => p.sessionId === sessionId)
}

function loadPosts() {
  try {
    const data = JSON.parse(fs.readFileSync(POSTS_FILE, 'utf8'))
    const now = Date.now()
    for (const [id, p] of Object.entries(data)) {
      const scheduledTime = new Date(p.scheduledAt).getTime()
      if (scheduledTime > now) {
        const delay = scheduledTime - now
        const timerId = setTimeout(() => executePost(id), delay)
        posts.set(id, { ...p, timerId })
      }
    }
    if (posts.size > 0) {
      console.log(`[scheduled-posts] Loaded ${posts.size} pending post(s)`)
    }
  } catch {}
}

module.exports = {
  createPost,
  updatePost,
  deletePost,
  getPost,
  getAllPosts,
  getPostsBySession,
  loadPosts
}
