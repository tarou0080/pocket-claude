const fs = require('fs')
const { randomUUID } = require('crypto')
const config = require('../config/index')

const TABS_FILE = config.TABS_FILE

// タブ読み込み
function loadTabs() {
  try {
    return JSON.parse(fs.readFileSync(TABS_FILE, 'utf8'))
  } catch {
    return []
  }
}

// タブ保存
function saveTabs(tabs) {
  fs.writeFileSync(TABS_FILE, JSON.stringify(tabs, null, 2))
}

// デフォルトプロジェクト取得
function getDefaultProject() {
  return Object.keys(config.projects)[0]
}

// 初回起動時にタブが0件なら既存セッションから移行 or デフォルト作成
function ensureDefaultTabs() {
  const tabs = loadTabs()
  if (tabs.length > 0) return

  const migrated = []
  for (const [proj] of Object.entries(config.projects)) {
    const sessFile = require('path').join(config.SESSIONS_DIR, `${proj}.json`)
    try {
      const { sessionId } = JSON.parse(fs.readFileSync(sessFile, 'utf8'))
      migrated.push({ id: randomUUID(), name: proj, project: proj, sessionId })
    } catch { /* セッションなし */ }
  }
  if (migrated.length > 0) {
    saveTabs(migrated)
  } else {
    saveTabs([{ id: randomUUID(), name: 'Conversation 1', project: getDefaultProject(), sessionId: null }])
  }
}

// ディレクトリ初期化（server.jsで使っていた処理を移行）
function initDirectories() {
  fs.mkdirSync(config.SESSIONS_DIR, { recursive: true })
  fs.mkdirSync(config.LOGS_DIR, { recursive: true })
}

module.exports = {
  loadTabs,
  saveTabs,
  getDefaultProject,
  ensureDefaultTabs,
  initDirectories
}
