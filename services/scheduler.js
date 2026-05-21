const fs = require('fs')
const path = require('path')
const { getClaudeSessionId } = require('./sessions')

const SCHEDULES_FILE = path.join(__dirname, '..', 'schedules.json')

// sessionId -> { resetAt, prompt, project, model, effort, thinking, timerId }
// prompt が null の場合は状態記録のみ（タイマーなし）
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
  console.log(`[resume] sessionId=${sessionId} prompt="${s.prompt}"`);

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
    console.log(`[resume] injecting into live process`)
    injectPrompt(sessionId, s.prompt)
  } else {
    console.log(`[resume] starting new claude process`)
    broadcast(sessionId, { type: 'user_input', text: s.prompt })
    startClaude(sessionId, s.prompt, s.model, s.project, claudeSessionId, s.effort, s.thinking)
  }
}

function scheduleResume(sessionId, resetAt, prompt, project, model, effort, thinking) {
  cancelResume(sessionId)
  const entry = {
    resetAt,
    prompt: prompt || null,
    project,
    model: model || null,
    effort: effort || null,
    thinking: thinking || null
  }
  if (prompt) {
    // +60s buffer: API の rate limit は resetAt ちょうどに発火すると境界で弾かれる race condition がある
    const delay = Math.max(0, new Date(resetAt).getTime() - Date.now()) + 60000
    entry.timerId = setTimeout(() => doResume(sessionId), delay)
  }
  schedules.set(sessionId, entry)
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
  return { resetAt: s.resetAt, autoResume: !!s.prompt }
}

function loadSchedules() {
  try {
    const data = JSON.parse(fs.readFileSync(SCHEDULES_FILE, 'utf8'))
    const now = Date.now()
    for (const [sessionId, s] of Object.entries(data)) {
      const resetTime = new Date(s.resetAt).getTime()
      if (resetTime > now) {
        const entry = { ...s }
        if (s.prompt) {
          const delay = resetTime - now
          entry.timerId = setTimeout(() => doResume(sessionId), delay)
        }
        schedules.set(sessionId, entry)
      }
      // 過去のスケジュールは破棄
    }
    if (schedules.size > 0) {
      console.log(`[scheduler] Loaded ${schedules.size} pending schedule(s)`)
    }
  } catch {}
}

module.exports = { scheduleResume, cancelResume, getSchedule, loadSchedules }
