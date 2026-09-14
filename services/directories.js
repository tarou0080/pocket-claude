const fs = require('fs')
const path = require('path')
const config = require('../config/index')

// 起動時のディレクトリ初期化（sessions/・logs/ が無ければ作る）。
// 旧 services/tabs.js から分離: タブ機能撤去後もディレクトリ初期化の責務だけは残す。
function initDirectories() {
  fs.mkdirSync(config.SESSIONS_DIR, { recursive: true })
  fs.mkdirSync(config.LOGS_DIR, { recursive: true })
  sweepStalePocketLogs()
}

// 起動時スイープ（v2.12.1）: logs/*.jsonl のうち本体jsonl（CLAUDE_PROJECTS_DIR側）が
// 既に存在するものを全削除する。pocketログの寿命は1ターン（spawner.js の result/error 直後の
// discardPocketLog）で通常は残らないが、サーバーが常駐プロセスの結果を受け取れずに落ちた場合
// （再起動・kill等）は破棄が走らず取り残る。起動時点では走っている会話は無い＝本体jsonlが
// あるログは確実に読み終えた過去のもの、というのが唯一の安全な判定基準。
// require はここで行う（server.js の require 順で directories.js が最初に読まれるため、
// 循環参照を避けてこの関数の呼び出し時点で遅延評価する）。
function sweepStalePocketLogs() {
  const { CLAUDE_PROJECTS_DIR } = require('./history')
  let deleted = 0
  let kept = 0
  let files
  try {
    files = fs.readdirSync(config.LOGS_DIR).filter(f => f.endsWith('.jsonl'))
  } catch {
    return
  }
  for (const file of files) {
    const sessionId = file.replace(/\.jsonl$/, '')
    const mainJsonl = path.join(CLAUDE_PROJECTS_DIR, `${sessionId}.jsonl`)
    if (fs.existsSync(mainJsonl)) {
      try {
        fs.unlinkSync(path.join(config.LOGS_DIR, file))
        deleted++
      } catch {}
    } else {
      kept++
    }
  }
  console.log(`[startup-sweep] deleted=${deleted} kept=${kept}`)
}

module.exports = { initDirectories }
