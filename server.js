const express = require('express')
const fs = require('fs')
const path = require('path')
const config = require('./config/index')
const { initDirectories, sweepRetention } = require('./services/directories')
const { readCleanupPeriodDays } = require('./services/claude-dir')
const claudeRouter = require('./routes/claude')
const streamRouter = require('./routes/stream')
const historyRouter = require('./routes/history')
const projectsRouter = require('./routes/projects')
const scheduledPostsRouter = require('./routes/scheduled-posts')
const serverConfigRouter = require('./routes/server-config')

const app = express()
const PORT = parseInt(process.env.PORT || config.port || 3333, 10)
if (isNaN(PORT) || PORT < 1024 || PORT > 65535) {
  console.error(`[startup] Invalid PORT: ${process.env.PORT || config.port}`)
  process.exit(1)
}
// バインド先アドレス。既定は全IF(0.0.0.0)だが config.host で特定IFに限定できる。
// リバースプロキシ経由のアクセスのみ許可しLANから直接叩かせない場合は、プロキシから到達できるIFのIPを指定する。
const HOST = process.env.HOST || config.host || '0.0.0.0'

// 保持日数（v2.13.0）: Claude Code の cleanupPeriodDays（managed > user settings、既定30）に
// 追従する。起動時に1回だけ読む＝設定変更は再起動で反映（services/claude-dir.js 参照）。
const retentionDays = readCleanupPeriodDays()

// ディレクトリ初期化
initDirectories(retentionDays)

// logs/*.jsonl・sessions/*.json の日数GC（v2.12.3、v2.13.0でsessionsにも拡大）: 起動時に
// 加えて日次でも走らせる（長期稼働で保持日数超のファイルが溜まらないようにするだけ・
// 破棄条件は services/directories.js の sweepRetention 参照）。
setInterval(() => sweepRetention(retentionDays), 24 * 60 * 60 * 1000).unref()

// 起動時マイグレーション（v2.12.0・schema version 1）: pocket ID と Claude session ID の
// 二重身分を廃止する。冪等（sessions/.schema.json）・変換前に tar.gz 退避・全件を起動ログへ出力。
// 子プロセスが誰もファイルを掴んでいない起動フェーズでのみ実行する（配信開始前）。
const { runStartupMigration } = require('./services/migrate')
if (process.argv.includes('--migrate-dry-run')) {
  console.log(JSON.stringify(runStartupMigration({ dryRun: true }), null, 2))
  process.exit(0)
}
// PC_SKIP_STARTUP_MIGRATION=1 で起動時マイグレーションを見送る（検証・トラブル時の逃げ道）。
// 通常運用では設定しない＝schema未達なら初回起動で1回だけ走り、以後は冪等にskipされる。
if (process.env.PC_SKIP_STARTUP_MIGRATION === '1') {
  console.log('[migrate] skipped (PC_SKIP_STARTUP_MIGRATION=1)')
} else {
  runStartupMigration()
}

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

const { loadSchedules } = require('./services/scheduler')
loadSchedules()

const { loadPosts } = require('./services/scheduled-posts')
loadPosts()

app.use((req, res, next) => {
  const mb = config.maxBodySizeMb
  const limit = (typeof mb === 'number' && mb > 0) ? `${mb}mb` : Infinity
  express.json({ limit })(req, res, next)
})


// Root endpoint - serve index.html with dynamic lang attribute
app.get('/', (req, res) => {
  const lang = config.uiLang || 'en'
  const htmlPath = path.join(__dirname, 'public', 'index.html')
  let html = fs.readFileSync(htmlPath, 'utf8')
  html = html.replace('<html lang="en">', `<html lang="${lang}">`)
  res.set('Cache-Control', 'no-store')
  res.set('Surrogate-Control', 'no-store')
  res.send(html)
})

app.use(express.static(path.join(__dirname, 'public')))

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    pid: process.pid
  })
})

app.get('/api/models', (req, res) => {
  const cfg = require('./config/index')
  const models = cfg.models && cfg.models.length > 0 ? cfg.models : [
    { value: '', label: 'Default' }
  ]
  res.json(models)
})

// API routes
app.use('/api', claudeRouter)
app.use('/api/stream', streamRouter)
app.use('/api/history', historyRouter)
app.use('/api/projects', projectsRouter)
app.use('/api/scheduled-posts', scheduledPostsRouter)
app.use('/api/server-config', serverConfigRouter)

const server = app.listen(PORT, HOST, () => {
  console.log(`pocket-claude v4 (modular) running on ${HOST}:${PORT}`)
})

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[startup] Port ${PORT} is already in use. Another instance may be running.`)
    console.error(`[startup] Check: lsof -i :${PORT} -P -n`)
    process.exit(1)
  } else {
    throw err
  }
})

// Graceful shutdown: SIGTERM/SIGINT時に実行中のプロセスを適切に終了
// unhandledRejection/uncaughtExceptionからも同じ経路で呼ぶため、二重発火を防ぐガードを持たせる
let shuttingDownReason = null
function gracefulShutdown(signal) {
  if (shuttingDownReason) {
    console.log(`[shutdown] Already shutting down (reason: ${shuttingDownReason}), ignoring ${signal}`)
    return
  }
  shuttingDownReason = signal
  console.log(`\n[${signal}] Graceful shutdown initiated...`)

  // 1. 新規リクエストを拒否
  server.close(() => {
    console.log('[shutdown] HTTP server closed')
  })

  // 2. 実行中のすべてのセッションに done イベントを送信
  const { getState, broadcast } = require('./services/stream')
  const { stopClaude } = require('./services/spawner')

  // state オブジェクトから全セッションIDを取得（stream.jsのstateは外部公開されていないため、
  // 実行中プロセスを持つセッションのみ処理）
  const logsDir = config.LOGS_DIR
  try {
    const files = fs.readdirSync(logsDir).filter(f => f.endsWith('.jsonl'))
    for (const file of files) {
      const sessionId = path.basename(file, '.jsonl')
      const s = getState(sessionId)

      // 実行中プロセスがあれば終了
      if (s.process) {
        console.log(`[shutdown] Stopping session: ${sessionId}`)
        broadcast(sessionId, {
          type: 'done',
          exitCode: -1,
          timestamp: new Date().toISOString(),
          reason: 'server_shutdown'
        })
        // shutdown中はinterrupt ACKの非同期待ちをせず、即SIGTERM(force)で確実に子プロセスを畳む
        // （そうしないと子プロセスがpocket-claude再起動後に孤児として残るおそれがある）
        stopClaude(sessionId, { force: true })
      }

      // SSEクライアントに終了を通知
      s.sseClients.forEach(res => {
        try {
          res.end()
        } catch {}
      })
    }
  } catch (err) {
    console.error('[shutdown] Error during cleanup:', err.message)
  }

  // 3. プロセス終了
  setTimeout(() => {
    console.log('[shutdown] Forcing exit')
    process.exit(0)
  }, 3000)
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT',  () => gracefulShutdown('SIGINT'))

// 未捕捉の例外・rejectionでプロセスが不定状態のまま生き続けるのを防ぐ。
// Restart=always（systemd）が復旧を担うので、ここでの責務は「理由とスタックを必ず残してから
// 落とす」ことに絞る。実行中セッションへの通知はgracefulShutdownの既存経路を再利用する。
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] Unhandled promise rejection:', reason && reason.stack ? reason.stack : reason)
  gracefulShutdown('unhandledRejection')
})

process.on('uncaughtException', (err) => {
  console.error('[fatal] Uncaught exception:', err && err.stack ? err.stack : err)
  gracefulShutdown('uncaughtException')
})
