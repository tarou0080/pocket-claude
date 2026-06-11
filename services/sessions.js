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
  try {
    fs.mkdirSync(sessionsDir, { recursive: true })
    fs.writeFileSync(path.join(sessionsDir, `${sessionId}.json`), JSON.stringify({ claudeSessionId }))
  } catch {}
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

module.exports = { getClaudeSessionId, saveClaudeSessionId, getSessionId, saveSessionId }
