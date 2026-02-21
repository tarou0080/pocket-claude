const fs = require('fs')
const path = require('path')

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

// プロジェクト設定読み込み
function loadProjects() {
  let projects
  try {
    projects = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'projects.json'), 'utf8'))
  } catch {
    const homeDir = process.env.HOME || path.join('/home', process.env.USER || 'user')
    projects = { home: homeDir }
  }

  // 環境変数からの追加パス
  if (process.env.ADDITIONAL_ALLOWED_DIRS) {
    const additionalDirs = process.env.ADDITIONAL_ALLOWED_DIRS.split(':')
    additionalDirs.forEach((dir, index) => {
      if (dir.trim()) {
        const name = `env_${index}`
        projects[name] = path.resolve(dir.trim())
      }
    })
  }

  // パスを正規化
  const normalized = {}
  for (const [name, dir] of Object.entries(projects)) {
    try {
      const resolved = path.resolve(dir)
      normalized[name] = fs.realpathSync(resolved)
    } catch (err) {
      console.warn(`[WARNING] Invalid project path: ${name} -> ${dir} (${err.message})`)
    }
  }

  // 有効なプロジェクトがない場合はデフォルトを追加
  if (Object.keys(normalized).length === 0) {
    const homeDir = process.env.HOME || path.join('/home', process.env.USER || 'user')
    normalized.home = homeDir
  }

  return normalized
}

const config = loadConfig()

module.exports = {
  ...config,
  projects: loadProjects(),
  SESSIONS_DIR: path.join(__dirname, '..', config.sessionDir || 'sessions'),
  LOGS_DIR: path.join(__dirname, '..', config.logsDir || 'logs'),
  TABS_FILE: path.join(__dirname, '..', 'tabs.json')
}
