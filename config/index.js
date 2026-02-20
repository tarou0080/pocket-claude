const fs = require('fs')
const path = require('path')
const { isPathAllowed } = require('./security')

// Load config.json
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'))
  } catch {
    return {
      port: 3333,
      permissionMode: 'ask',
      sessionDir: './sessions',
      logsDir: './logs'
    }
  }
}

// プロジェクト設定読み込み（Path Traversal対策付き）
function loadProjects() {
  let raw
  try {
    raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'projects.json'), 'utf8'))
  } catch {
    const homeDir = process.env.HOME || path.join('/home', process.env.USER || 'user')
    raw = { home: homeDir }
  }

  // セキュリティ: 許可されたディレクトリのみ受け入れる
  const sanitized = {}
  for (const [name, dir] of Object.entries(raw)) {
    try {
      const resolved = path.resolve(dir)
      const realPath = fs.realpathSync(resolved)  // シンボリックリンク解決

      // 許可されたベースディレクトリ内かチェック
      const isAllowed = isPathAllowed(realPath)
      if (isAllowed) {
        sanitized[name] = realPath
      } else {
        console.warn(`[SECURITY] Rejected project path: ${name} -> ${dir} (resolved: ${realPath})`)
      }
    } catch (err) {
      console.warn(`[SECURITY] Invalid project path: ${name} -> ${dir} (${err.message})`)
    }
  }

  // 有効なプロジェクトがない場合はデフォルトを追加
  if (Object.keys(sanitized).length === 0) {
    const homeDir = process.env.HOME || path.join('/home', process.env.USER || 'user')
    sanitized.home = homeDir
  }

  return sanitized
}

const config = loadConfig()

module.exports = {
  ...config,
  projects: loadProjects(),
  SESSIONS_DIR: path.join(__dirname, '..', config.sessionDir || 'sessions'),
  LOGS_DIR: path.join(__dirname, '..', config.logsDir || 'logs'),
  TABS_FILE: path.join(__dirname, '..', 'tabs.json')
}
