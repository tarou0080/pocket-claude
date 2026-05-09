const fs = require('fs')
const path = require('path')
const { getClaudeSessionId } = require('./sessions')

const SCHEDULES_FILE = path.join(__dirname, '..', 'schedules.json')

// sessionId -> { resetAt, prompt, project, model, effort, thinking, timerId }
const schedules = new Map()

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
  const { startClaude, injectPrompt, gitPull } = require('./spawner')
  const config = require('../config/index')

  const state = getState(sessionId)
  const claudeSessionId = getClaudeSessionId(sessionId)
  const projectDir = config.projects[s.project]

  if (projectDir) {
    const pulled = await gitPull(projectDir)
    if (pulled) broadcast(sessionId, { type: 'system', text: `git pull: ${pulled}` })
  }

  broadcast(sessionId, { type: 'system', text: '⏱ レート制限リセット後、自動再開しました' })

  if (state.process) {
    // 常駐プロセスが生きている（レートリミット後もstdinを待機中）→ 注入
    injectPrompt(sessionId, s.prompt)
  } else {
    broadcast(sessionId, { type: 'user_input', text: s.prompt })
    startClaude(sessionId, s.prompt, s.model, s.project, claudeSessionId, s.effort, s.thinking)
  }
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
