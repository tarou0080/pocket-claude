const fs = require('fs')
const path = require('path')
const config = require('../config/index')
const { readCleanupPeriodDays } = require('./claude-dir')

// 起動時のディレクトリ初期化（logs/ が無ければ作る）。
// v2.14.0: sessions/ は sessions/*.json を保持しなくなったため初期化対象から外れ、
// logs/（pocketのライブログ）だけを残す。
function initDirectories(maxAgeDays = readCleanupPeriodDays()) {
  fs.mkdirSync(config.LOGS_DIR, { recursive: true })
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
