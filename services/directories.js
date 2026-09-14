const fs = require('fs')
const path = require('path')
const config = require('../config/index')

// 起動時のディレクトリ初期化（sessions/・logs/ が無ければ作る）。
// 旧 services/tabs.js から分離: タブ機能撤去後もディレクトリ初期化の責務だけは残す。
function initDirectories() {
  fs.mkdirSync(config.SESSIONS_DIR, { recursive: true })
  fs.mkdirSync(config.LOGS_DIR, { recursive: true })
  sweepOldPocketLogs()
}

// 日数GC（v2.12.3）: logs/*.jsonl のうち mtime が maxAgeDays 日より古いものを削除する。
// 旧v2.12.1〜v2.12.2は「本体jsonl（CLAUDE_PROJECTS_DIR側）が既に存在する＝冗長」として
// 削除していたが、本体jsonlはサーバー側の事実（done/result/start/stderr）を持たず、
// 再起動を跨ぐとタブから開始マーカー・トークン%・Interrupted表示が消える不具合の原因になった。
// pocketログは画面履歴の正であり、境界は log_start.mainLines がログの長さに関係なく
// 正確に切るため、残しても二重描画にはならない。寿命は単純な日数だけで管理する。
// `.jsonl` 以外（server.log 等）は対象外。起動時（initDirectories）と日次（server.js の
// setInterval）から呼ばれる。
function sweepOldPocketLogs(maxAgeDays = 30, dir = config.LOGS_DIR) {
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000
  const now = Date.now()
  let deleted = 0
  let kept = 0
  let files
  try {
    files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'))
  } catch {
    return
  }
  for (const file of files) {
    const filePath = path.join(dir, file)
    try {
      const stat = fs.statSync(filePath)
      if (now - stat.mtimeMs > maxAgeMs) {
        fs.unlinkSync(filePath)
        deleted++
      } else {
        kept++
      }
    } catch {}
  }
  console.log(`[log-gc] deleted=${deleted} kept=${kept}`)
}

module.exports = { initDirectories, sweepOldPocketLogs }
