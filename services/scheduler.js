const fs = require('fs')
const path = require('path')

const SCHEDULES_FILE = path.join(__dirname, '..', 'schedules.json')

// resetAt ちょうどに発火すると API のリセット境界 race condition で即 429 になるため、
// 実際のキックは resetAt から 3分後にする（旧 60秒 から拡大）。
const RESUME_BUFFER_MS = 180000
// 同じ時刻に再開するセッションが複数あると一斉再送で再び制限に当たる。
// 衝突するものは 3分 ずつ後ろの空きスロットへずらす。
const STAGGER_MS = 180000

// sessionId -> { resetAt, prompt, project, model, effort, thinking, fireAt, timerId }
// prompt が null の場合は状態記録のみ（再開しない＝ずらし対象外）
// fireAt は実際にタイマーが発火する時刻(ms)。カードはこの時刻を表示する。
const schedules = new Map()

// 他の「実際に再開する(prompt有り)」エントリの fireAt と STAGGER_MS 未満で
// 被らない発火時刻を返す。被る間は STAGGER_MS ずつ後ろへずらす。
function computeFireAt(baseFireAt, excludeSessionId) {
  const taken = []
  schedules.forEach((s, id) => {
    if (id !== excludeSessionId && s.prompt && s.fireAt) taken.push(s.fireAt)
  })
  let fireAt = baseFireAt
  while (taken.some(t => Math.abs(t - fireAt) < STAGGER_MS)) fireAt += STAGGER_MS
  return fireAt
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
  console.log(`[resume] sessionId=${sessionId} prompt="${s.prompt}"`);

  const { broadcast } = require('./stream')
  const { deliverPrompt, gitPull } = require('./spawner')
  const { getSessionSettings } = require('./sessions')
  const config = require('../config/index')

  // レコードの値 → セッション保存値 → 既定 の順で解決する。
  // この登録エントリが古いバグの副作用でmodel/effort/thinking無しのまま保存されていても、
  // そのタブが最後に使っていた設定へフォールバックできるようにする（予約投稿と同じ考え方）。
  const settings = getSessionSettings(sessionId)
  const project = s.project || settings.project
  const model = s.model || settings.model
  const effort = s.effort || settings.effort
  const thinking = s.thinking != null ? s.thinking : settings.thinking

  const projectDir = config.projects[project]
  if (projectDir) {
    const pulled = await gitPull(projectDir)
    if (pulled) broadcast(sessionId, { type: 'system', text: `git pull: ${pulled}` })
  }

  // 生存確認→注入/--resume起動。失敗時の system イベント broadcast は deliverPrompt が担う。
  const result = deliverPrompt(sessionId, s.prompt, { project, model, effort, thinking })
  console.log(`[resume] deliverPrompt result=${result.status} sessionId=${sessionId}`)

  if (result.status === 'injected' || result.status === 'started') {
    // 配送成功を確認してから消す・成功を知らせる（配送前の無条件表示は嘘表示になる）
    schedules.delete(sessionId)
    saveSchedules()
    broadcast(sessionId, { type: 'system', text: '⏱ レート制限リセット後、自動再開しました' })
  } else {
    // 配送失敗。エントリを残しても再発火はしない（このタイマーは使い切り）ため、
    // 予約投稿のような再送UIが無い現状ではここに留め置いても救済されない。
    // 黙って消さず、失敗を必ずチャットへ出す（カード自体は既存仕様どおりエントリ消滅で消える）。
    const reason = result.reason || '配送に失敗しました'
    schedules.delete(sessionId)
    saveSchedules()
    broadcast(sessionId, { type: 'system', text: `⚠ 自動再開できませんでした: ${reason}` })
  }
}

function scheduleResume(sessionId, resetAt, prompt, project, model, effort, thinking) {
  // prompt無しの保存（resetAt記録のみ）が、既存のON登録（prompt有り）を破壊しないようにする。
  // rate_limitが複数回届くと、後発のprompt無しPOSTがON用タイマーをcancelResumeで潰す問題への対処。
  const existing = schedules.get(sessionId)
  if (!prompt && existing && existing.prompt) return
  cancelResume(sessionId)
  const baseFireAt = Math.max(Date.now(), new Date(resetAt).getTime()) + RESUME_BUFFER_MS
  // prompt有り（実際に再開する）エントリのみ同時刻衝突を避けてずらす
  const fireAt = prompt ? computeFireAt(baseFireAt, sessionId) : baseFireAt
  const entry = {
    resetAt,
    prompt: prompt || null,
    project,
    model: model || null,
    effort: effort || null,
    thinking: thinking || null,
    fireAt
  }
  const delay = Math.max(0, fireAt - Date.now())
  if (prompt) {
    entry.timerId = setTimeout(() => doResume(sessionId), delay)
  } else {
    // 状態記録のみのエントリはresetAt経過で自動破棄（クライアントDELETE頼みにしない）
    entry.timerId = setTimeout(() => expireEntry(sessionId), delay)
  }
  schedules.set(sessionId, entry)
  saveSchedules()
}

// prompt無しエントリ（resetAt状態記録のみ）の期限切れ破棄。
// ON登録（prompt有り）に昇格していた場合は何もしない（doResumeが寿命を管理する）。
function expireEntry(sessionId) {
  const s = schedules.get(sessionId)
  if (!s || s.prompt) return
  schedules.delete(sessionId)
  saveSchedules()
  console.log(`[scheduler] expired resetAt entry sessionId=${sessionId}`)
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
  return {
    resetAt: s.resetAt,
    fireAt: s.fireAt ? new Date(s.fireAt).toISOString() : null,
    autoResume: !!s.prompt
  }
}

function loadSchedules() {
  try {
    const data = JSON.parse(fs.readFileSync(SCHEDULES_FILE, 'utf8'))
    const now = Date.now()
    for (const [sessionId, s] of Object.entries(data)) {
      const resetTime = new Date(s.resetAt).getTime()
      if (resetTime > now) {
        // 再起動後も同じバッファ・ずらしロジックで発火時刻を再計算する
        const baseFireAt = Math.max(now, resetTime) + RESUME_BUFFER_MS
        const fireAt = s.prompt ? computeFireAt(baseFireAt, sessionId) : baseFireAt
        const entry = { ...s, fireAt }
        const delay = Math.max(0, fireAt - now)
        if (s.prompt) {
          entry.timerId = setTimeout(() => doResume(sessionId), delay)
        } else {
          entry.timerId = setTimeout(() => expireEntry(sessionId), delay)
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
