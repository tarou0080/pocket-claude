const fs = require('fs')
const path = require('path')
const { writeJsonAtomic } = require('./persist')

const sessionsDir = path.join(__dirname, '..', 'sessions')

// pocket-session ID から Claude session ID を取得
function getClaudeSessionId(sessionId) {
  try {
    return JSON.parse(fs.readFileSync(path.join(sessionsDir, `${sessionId}.json`), 'utf8')).claudeSessionId || null
  } catch { return null }
}

// pocket-session ID と Claude session ID のマッピングを保存
function saveClaudeSessionId(sessionId, claudeSessionId) {
  saveSessionMeta(sessionId, { claudeSessionId })
}

// セッションマッピングファイルを読み込む（存在しなければ空オブジェクト）
function loadSessionMeta(sessionId) {
  try {
    return JSON.parse(fs.readFileSync(path.join(sessionsDir, `${sessionId}.json`), 'utf8'))
  } catch { return {} }
}

// セッションマッピングファイルへ部分更新をマージして保存する
// （claudeSessionId / project など既存フィールドを壊さずに追記できる）
function saveSessionMeta(sessionId, updates) {
  try {
    fs.mkdirSync(sessionsDir, { recursive: true })
  } catch (err) {
    console.error('[persist] Failed to create sessions dir:', err.message)
    return false
  }
  const current = loadSessionMeta(sessionId)
  const ok = writeJsonAtomic(path.join(sessionsDir, `${sessionId}.json`), { ...current, ...updates })
  if (ok) indexEntry(sessionId, updates.claudeSessionId || current.claudeSessionId)
  return ok
}

// セッションに紐づくプロジェクト名を取得
function getSessionProject(sessionId) {
  return loadSessionMeta(sessionId).project || null
}

// セッションに紐づくプロジェクト名を保存
function saveSessionProject(sessionId, project) {
  if (!project) return
  saveSessionMeta(sessionId, { project })
}

// セッションに紐づく設定一式（project/model/effort/thinking）を取得。
// 自動再開・予約投稿のように「呼び出し元が引数を渡し忘れる/古い値のまま」でも
// 最後にそのタブで使われていた設定へフォールバックできるようにするための救済経路。
function getSessionSettings(sessionId) {
  const m = loadSessionMeta(sessionId)
  return {
    project: m.project || null,
    model: m.model || null,
    effort: m.effort || null,
    thinking: m.thinking !== undefined ? m.thinking : null,
  }
}

// ── Claude session ID → pocket session ID の逆引き ─────────────────────────
// マッピングは pocket→Claude の一方向でしか持っていなかったため、履歴一覧（Claude ID）から
// 「その会話が今どの pocket セッションで生きているか」を辿れなかった。結果、実行中の会話を
// 履歴から開くと本体とは別IDの“影のタブ”ができ、ライブ配信も実行中フラグも届かなかった。
// 逆引きは sessions/ の全走査になるため一度だけ作ってメモリに持ち、以後は書き込み/削除の
// 経路（saveSessionMeta / forgetSession）で更新する＝走査は起動後1回きり。
let claudeToPockets = null

function indexEntry(pocketSessionId, claudeSessionId) {
  if (!claudeToPockets || !claudeSessionId) return
  const list = claudeToPockets.get(claudeSessionId) || []
  if (!list.includes(pocketSessionId)) list.push(pocketSessionId)
  claudeToPockets.set(claudeSessionId, list)
}

function buildIndex() {
  claudeToPockets = new Map()
  let files = []
  try {
    files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'))
  } catch { return }
  for (const f of files) {
    const pocketSessionId = f.slice(0, -'.json'.length)
    const claudeSessionId = loadSessionMeta(pocketSessionId).claudeSessionId
    indexEntry(pocketSessionId, claudeSessionId)
  }
}

// 指定した Claude session ID に紐づく pocket session ID の一覧（新しい順）
function findPocketSessionIds(claudeSessionId) {
  if (!claudeToPockets) buildIndex()
  const list = (claudeToPockets.get(claudeSessionId) || []).slice()
  // 同じ会話に複数の pocket セッションが紐づきうる（履歴からの復帰を繰り返した場合）。
  // 呼び出し側が「生きている方」を優先できるよう、まず最終更新の新しい順に並べて返す。
  return list
    .map(id => {
      let mtime = 0
      try { mtime = fs.statSync(path.join(sessionsDir, `${id}.json`)).mtimeMs } catch {}
      return { id, mtime }
    })
    .sort((a, b) => b.mtime - a.mtime)
    .map(e => e.id)
}

// セッション削除時に逆引きからも落とす（残すと存在しないIDを live として返しうる）
function forgetSession(pocketSessionId) {
  if (!claudeToPockets) return
  for (const [claudeSessionId, list] of claudeToPockets) {
    const i = list.indexOf(pocketSessionId)
    if (i === -1) continue
    list.splice(i, 1)
    if (list.length === 0) claudeToPockets.delete(claudeSessionId)
  }
}

// セッションに紐づく設定一式を保存（渡されたキーのみ部分更新）
function saveSessionSettings(sessionId, { project, model, effort, thinking } = {}) {
  const updates = {}
  if (project !== undefined) updates.project = project
  if (model !== undefined) updates.model = model
  if (effort !== undefined) updates.effort = effort
  if (thinking !== undefined) updates.thinking = thinking
  if (Object.keys(updates).length) saveSessionMeta(sessionId, updates)
}

module.exports = {
  getClaudeSessionId,
  saveClaudeSessionId,
  getSessionProject,
  saveSessionProject,
  getSessionSettings,
  saveSessionSettings,
  findPocketSessionIds,
  forgetSession,
}
