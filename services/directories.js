const fs = require('fs')
const path = require('path')
const config = require('../config/index')
const { readCleanupPeriodDays } = require('./claude-dir')

// 起動時のディレクトリ初期化（sessions/・logs/ が無ければ作る）。
// 旧 services/tabs.js から分離: タブ機能撤去後もディレクトリ初期化の責務だけは残す。
// v2.13.0: 保持日数は Claude Code の cleanupPeriodDays に追従する（config/claude-dir.js 参照）。
// 起動時に1回だけ読む＝設定変更は再起動で反映。
function initDirectories(maxAgeDays = readCleanupPeriodDays()) {
  fs.mkdirSync(config.SESSIONS_DIR, { recursive: true })
  fs.mkdirSync(config.LOGS_DIR, { recursive: true })
  sweepRetention(maxAgeDays)
}

// 日数GC（v2.12.3、v2.13.0で汎用化）: dir 配下の拡張子 ext のファイルのうち mtime が
// maxAgeDays 日より古いものを削除する。exclude はファイル名の除外リスト（触らない）。
// 旧v2.12.1〜v2.12.2は「本体jsonl（CLAUDE_PROJECTS_DIR側）が既に存在する＝冗長」として
// 削除していたが、本体jsonlはサーバー側の事実（done/result/start/stderr）を持たず、
// 再起動を跨ぐとタブから開始マーカー・トークン%・Interrupted表示が消える不具合の原因になった。
// pocketログは画面履歴の正であり、境界は log_start.mainLines がログの長さに関係なく
// 正確に切るため、残しても二重描画にはならない。寿命は単純な日数だけで管理する。
function sweepOldFiles(dir, ext, maxAgeDays, { exclude = [] } = {}) {
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000
  const now = Date.now()
  let deleted = 0
  let kept = 0
  let files
  try {
    files = fs.readdirSync(dir).filter(f => f.endsWith(ext) && !exclude.includes(f))
  } catch {
    return { deleted, kept }
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
  return { deleted, kept }
}

// logs/*.jsonl と sessions/*.json（pocketのセッションメタ）を同じ日数で掃除する。
// sessions/.schema.json はマイグレーションの版管理ファイルなので除外する。
// 起動時（initDirectories）と日次（server.js の setInterval）から同じ maxAgeDays で呼ばれる。
function sweepRetention(maxAgeDays) {
  const logs = sweepOldFiles(config.LOGS_DIR, '.jsonl', maxAgeDays)
  const sessions = sweepOldFiles(config.SESSIONS_DIR, '.json', maxAgeDays, { exclude: ['.schema.json'] })
  console.log(`[retention-gc] days=${maxAgeDays} logs deleted=${logs.deleted} kept=${logs.kept} sessions deleted=${sessions.deleted} kept=${sessions.kept}`)
}

module.exports = { initDirectories, sweepOldFiles, sweepRetention }
