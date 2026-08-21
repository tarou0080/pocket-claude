const fs = require('fs')
const config = require('../config/index')

// 起動時のディレクトリ初期化（sessions/・logs/ が無ければ作る）。
// 旧 services/tabs.js から分離: タブ機能撤去後もディレクトリ初期化の責務だけは残す。
function initDirectories() {
  fs.mkdirSync(config.SESSIONS_DIR, { recursive: true })
  fs.mkdirSync(config.LOGS_DIR, { recursive: true })
}

module.exports = { initDirectories }
