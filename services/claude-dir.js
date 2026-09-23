const fs = require('fs')
const path = require('path')

// Claude Code の設定ディレクトリの場所。CLAUDE_CONFIG_DIR が設定されていればそれに
// 追従する（history.js が ~/.claude を固定計算していたのを一本化・v2.13.0）。
const homeDir = process.env.HOME || path.join('/home', process.env.USER || 'user')
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(homeDir, '.claude')

// CLI が会話jsonlを置くディレクトリ名は「cwd の英数字以外を全部 '-'」（CLI本体の実装に合わせる。
// 旧実装は '/' だけ置換しており、'.' や '_' を含むパスでは実在しないディレクトリを指していた）。
// 200文字を超える名前は CLI が先頭200文字＋'-'＋ハッシュにするので、その接頭辞で実在ディレクトリを探す。
const MAX_DIR_NAME = 200
function projectDirFor(cwd) {
  const projectsRoot = path.join(CLAUDE_DIR, 'projects')
  const name = cwd.replace(/[^a-zA-Z0-9]/g, '-')
  if (name.length <= MAX_DIR_NAME) return path.join(projectsRoot, name)
  const prefix = name.slice(0, MAX_DIR_NAME) + '-'
  try {
    const hit = fs.readdirSync(projectsRoot).find(d => d.startsWith(prefix))
    if (hit) return path.join(projectsRoot, hit)
  } catch {}
  return path.join(projectsRoot, prefix)
}

// 既定（home）プロジェクトの会話置き場。互換のため残す。
const CLAUDE_PROJECTS_DIR = projectDirFor(homeDir)

// 登録済みの全プロジェクトの会話置き場（重複除去）。config は呼び出し時に読む＝テストで差し替え可。
function projectDirs() {
  const config = require('../config/index')
  const dirs = Object.values(config.projects || {}).map(projectDirFor)
  if (dirs.length === 0) dirs.push(CLAUDE_PROJECTS_DIR)
  return [...new Set(dirs)]
}

// セッションIDから本体jsonlの実パスを探す（どのプロジェクトで走った会話でも見つける）。
// 見つからなければ null。id の形式検査は呼び出し側の責務（UUID_RE）。
function findTranscript(id) {
  for (const dir of projectDirs()) {
    const p = path.join(dir, `${id}.jsonl`)
    if (fs.existsSync(p)) return p
  }
  return null
}

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

module.exports = { CLAUDE_DIR, CLAUDE_PROJECTS_DIR, projectDirFor, projectDirs, findTranscript, readCleanupPeriodDays }
