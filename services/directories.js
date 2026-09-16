const fs = require('fs')
const path = require('path')
const config = require('../config/index')
const { readCleanupPeriodDays, CLAUDE_PROJECTS_DIR } = require('./claude-dir')
const { migrateLegacyLogs } = require('./log-migrate')

// 起動時のディレクトリ初期化（logs/ が無ければ作る）。
// v2.14.0: セッションメタデータを保持しなくなったため初期化対象は logs/（pocketの
// ライブログ）だけ。
// v2.15.0: 旧形式（log_start先頭）のpocketログを after 形式へ一括変換してから
// GCに回す（migrate対象がGCで消されるのを防ぐため変換が先）。
function initDirectories(maxAgeDays = readCleanupPeriodDays()) {
  fs.mkdirSync(config.LOGS_DIR, { recursive: true })
  const migrated = migrateLegacyLogs(config.LOGS_DIR, CLAUDE_PROJECTS_DIR)
  if (migrated.length) console.log(`[log-migrate] converted ${migrated.length} legacy log(s)`)
  sweepRetention(maxAgeDays)
}

// 日数GC（v2.12.3）: dir 配下の拡張子 ext のファイルのうち mtime が maxAgeDays 日より
// 古いものを削除する。exclude はファイル名の除外リスト（触らない）。
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

// logs/*.jsonl（pocketライブログ）を日数で掃除する。
// 本体jsonlはClaude Codeの管轄なのでここでは触らない。
function sweepRetention(maxAgeDays) {
  const logs = sweepOldFiles(config.LOGS_DIR, '.jsonl', maxAgeDays)
  console.log(`[retention-gc] days=${maxAgeDays} logs deleted=${logs.deleted} kept=${logs.kept}`)
}

module.exports = { initDirectories, sweepOldFiles, sweepRetention }
