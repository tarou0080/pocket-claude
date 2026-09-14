const fs = require('fs')
const path = require('path')

// Claude Code の設定ディレクトリの場所。CLAUDE_CONFIG_DIR が設定されていればそれに
// 追従する（history.js が ~/.claude を固定計算していたのを一本化・v2.13.0）。
const homeDir = process.env.HOME || path.join('/home', process.env.USER || 'user')
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(homeDir, '.claude')
const CLAUDE_PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects', homeDir.replace(/\//g, '-'))

const DEFAULT_CLEANUP_DAYS = 30

// Claude Code の cleanupPeriodDays を読む。managed-settings.json（管理者設定）が
// user settings.json より優先される（Claude Code の設定優先順位に合わせる）。
// project/local settings は読まない（このプロセスの作業ディレクトリとは無関係な値のため）。
// files: [managedPath, userPath] を既定値付きで受け、テストから注入できる。
function readCleanupPeriodDays(files = [
  '/etc/claude-code/managed-settings.json',
  path.join(CLAUDE_DIR, 'settings.json'),
]) {
  for (const file of files) {
    let raw
    try {
      raw = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }
    let json
    try {
      json = JSON.parse(raw)
    } catch {
      continue
    }
    if (json && Object.prototype.hasOwnProperty.call(json, 'cleanupPeriodDays')) {
      const value = parseInt(json.cleanupPeriodDays, 10)
      if (Number.isFinite(value) && value >= 1) return value
      console.warn(`[log-gc] invalid cleanupPeriodDays in ${file}: ${json.cleanupPeriodDays} -> ${DEFAULT_CLEANUP_DAYS}`)
      return DEFAULT_CLEANUP_DAYS
    }
  }
  return DEFAULT_CLEANUP_DAYS
}

module.exports = { CLAUDE_DIR, CLAUDE_PROJECTS_DIR, readCleanupPeriodDays }
