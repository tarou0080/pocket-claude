const express = require('express')
const fs = require('fs')
const path = require('path')
const config = require('./config/index')
const { initDirectories, ensureDefaultTabs } = require('./services/tabs')
const tabsRouter = require('./routes/tabs')
const claudeRouter = require('./routes/claude')
const streamRouter = require('./routes/stream')
const historyRouter = require('./routes/history')

const app = express()
const PORT = process.env.PORT || config.port || 3333

// ディレクトリ初期化
initDirectories()
ensureDefaultTabs()

app.use(express.json())

// Root endpoint - serve index.html with dynamic lang attribute
app.get('/', (req, res) => {
  const lang = config.uiLang || 'en'
  const htmlPath = path.join(__dirname, 'public', 'index.html')
  let html = fs.readFileSync(htmlPath, 'utf8')
  html = html.replace('<html lang="en">', `<html lang="${lang}">`)
  // キャッシュ無効化（開発用）
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')
  res.send(html)
})

app.use(express.static(path.join(__dirname, 'public')))

// API routes
app.use('/api/tabs', tabsRouter)
app.use('/api', claudeRouter)
app.use('/api/stream', streamRouter)
app.use('/api/history', historyRouter)

app.listen(PORT, '0.0.0.0', () => {
  console.log(`pocket-claude v4 (modular) running on port ${PORT}`)
})
