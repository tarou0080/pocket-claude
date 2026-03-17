const express = require('express')
const fs = require('fs')
const path = require('path')
const config = require('./config/index')
const { initDirectories, ensureDefaultTabs } = require('./services/tabs')
const tabsRouter = require('./routes/tabs')
const claudeRouter = require('./routes/claude')
const streamRouter = require('./routes/stream')
const historyRouter = require('./routes/history')
const projectsRouter = require('./routes/projects')

const app = express()
const PORT = process.env.PORT || config.port || 3333

// ディレクトリ初期化
initDirectories()
ensureDefaultTabs()

// 起動時: 未完了ログを修復（start あり・done なし → 強制 done を追記）
// サーバーが実行中に再起動した場合、UIが「生成中」で詰まるのを防ぐ
function repairIncompleteLogs() {
  const logsDir = config.LOGS_DIR
  let repaired = 0
  try {
    const files = fs.readdirSync(logsDir).filter(f => f.endsWith('.jsonl'))
    for (const file of files) {
      const filePath = path.join(logsDir, file)
      try {
        const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(l => l.trim())
        const events = lines.map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
        const hasStart = events.some(e => e.type === 'start')
        const hasDone  = events.some(e => e.type === 'done')
        if (hasStart && !hasDone) {
          const syntheticDone = JSON.stringify({
            type: 'done',
            exitCode: -1,
            timestamp: new Date().toISOString(),
            reason: 'server_restart'
          })
          fs.appendFileSync(filePath, syntheticDone + '\n')
          repaired++
        }
      } catch {}
    }
  } catch {}
  if (repaired > 0) console.log(`[startup] Repaired ${repaired} incomplete log(s)`)
}
repairIncompleteLogs()

app.use(express.json())

// Root endpoint - serve index.html with dynamic lang attribute
app.get('/', (req, res) => {
  const lang = config.uiLang || 'en'
  const htmlPath = path.join(__dirname, 'public', 'index.html')
  let html = fs.readFileSync(htmlPath, 'utf8')
  html = html.replace('<html lang="en">', `<html lang="${lang}">`)
  res.send(html)
})

app.use(express.static(path.join(__dirname, 'public')))

// API routes
app.use('/api/tabs', tabsRouter)
app.use('/api', claudeRouter)
app.use('/api/stream', streamRouter)
app.use('/api/history', historyRouter)
app.use('/api/projects', projectsRouter)

app.listen(PORT, '0.0.0.0', () => {
  console.log(`pocket-claude v4 (modular) running on port ${PORT}`)
})
