const fs = require('fs')
const path = require('path')
const { loadTabs, saveTabs } = require('./tabs')

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
    const current = loadSessionMeta(sessionId)
    fs.writeFileSync(path.join(sessionsDir, `${sessionId}.json`), JSON.stringify({ ...current, ...updates }))
  } catch {}
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

// セッションに紐づく設定一式を保存（渡されたキーのみ部分更新）
function saveSessionSettings(sessionId, { project, model, effort, thinking } = {}) {
  const updates = {}
  if (project !== undefined) updates.project = project
  if (model !== undefined) updates.model = model
  if (effort !== undefined) updates.effort = effort
  if (thinking !== undefined) updates.thinking = thinking
  if (Object.keys(updates).length) saveSessionMeta(sessionId, updates)
}

// セッションID取得
function getSessionId(tabId) {
  const tabs = loadTabs()
  const tab = tabs.find(t => t.id === tabId)
  return tab?.sessionId || null
}

// セッションID保存
function saveSessionId(tabId, sessionId) {
  const tabs = loadTabs()
  const tab = tabs.find(t => t.id === tabId)
  if (tab) {
    tab.sessionId = sessionId
    saveTabs(tabs)
  }
}

module.exports = {
  getClaudeSessionId,
  saveClaudeSessionId,
  getSessionId,
  saveSessionId,
  getSessionProject,
  saveSessionProject,
  getSessionSettings,
  saveSessionSettings,
}
