const fs = require('fs')
const path = require('path')

const SCHEDULES_FILE = path.join(__dirname, '..', 'schedules.json')
const sessionsDir = path.join(__dirname, '..', 'sessions')

// sessionId -> { resetAt, prompt, project, model, effort, thinking, timerId }
const schedules = new Map()

function getClaudeSessionId(sessionId) {
  try {
    return JSON.parse(fs.readFileSync(path.join(sessionsDir, `${sessionId}.json`), 'utf8')).claudeSessionId || null
  } catch { return null }
}

function saveSchedules() {
  const data = {}
  schedules.forEach((s, id) => {
    data[id] = {
      resetAt: s.resetAt,
      prompt: s.prompt,
      project: s.project,
      model: s.model,
      effort: s.effort,
      thinking: s.thinking
    }
  })
  try { fs.writeFileSync(SCHEDULES_FILE, JSON.stringify(data)) } catch {}
}

async function doResume(sessionId) {
  const s = schedules.get(sessionId)
  if (!s) return
  schedules.delete(sessionId)
  saveSchedules()

  const { getState, broadcast } = require('./stream')
  const { startClaude, gitPull } = require('./spawner')
  const config = require('../config/index')

  // すでに実行中なら何もしない（手動送信が先行した場合）
  const state = getState(sessionId)
  if (state.process) return

  const claudeSessionId = getClaudeSessionId(sessionId)
  const projectDir = config.projects[s.project]

  if (projectDir) {
    const pulled = await gitPull(projectDir)
    if (pulled) broadcast(sessionId, { type: 'system', text: `git pull: ${pulled}` })
  }

  broadcast(sessionId, { type: 'system', text: '⏱ レート制限リセット後、自動再開しました' })
  broadcast(sessionId, { type: 'user_input', text: s.prompt })
  startClaude(sessionId, s.prompt, s.model, s.project, claudeSessionId, s.effort, s.thinking)
}

function scheduleResume(sessionId, resetAt, prompt, project, model, effort, thinking) {
  cancelResume(sessionId)
  const delay = Math.max(0, new Date(resetAt).getTime() - Date.now())
  const timerId = setTimeout(() => doResume(sessionId), delay)
  schedules.set(sessionId, {
    resetAt,
    prompt,
    project,
    model: model || null,
    effort: effort || null,
    thinking: thinking || null,
    timerId
  })
  saveSchedules()
}

function cancelResume(sessionId) {
  const s = schedules.get(sessionId)
  if (!s) return
  clearTimeout(s.timerId)
  schedules.delete(sessionId)
  saveSchedules()
}

function getSchedule(sessionId) {
  const s = schedules.get(sessionId)
  if (!s) return null
  return { resetAt: s.resetAt, prompt: s.prompt }
}

function loadSchedules() {
  try {
    const data = JSON.parse(fs.readFileSync(SCHEDULES_FILE, 'utf8'))
    const now = Date.now()
    for (const [sessionId, s] of Object.entries(data)) {
      const resetTime = new Date(s.resetAt).getTime()
      if (resetTime > now) {
        const delay = resetTime - now
        const timerId = setTimeout(() => doResume(sessionId), delay)
        schedules.set(sessionId, { ...s, timerId })
      }
      // 過去のスケジュールは破棄
    }
    if (schedules.size > 0) {
      console.log(`[scheduler] Loaded ${schedules.size} pending schedule(s)`)
    }
  } catch {}
}

module.exports = { scheduleResume, cancelResume, getSchedule, loadSchedules }
