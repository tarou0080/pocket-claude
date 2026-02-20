const { loadTabs, saveTabs } = require('./tabs')

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

module.exports = { getSessionId, saveSessionId }
