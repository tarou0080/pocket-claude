const fs = require('fs')
const path = require('path')
const express = require('express')
const router = express.Router()
const { getState, loadLogFile, registerSSEClient, unregisterSSEClient, classifyCursor } = require('../services/stream')
const { UUID_RE, CLAUDE_PROJECTS_DIR } = require('../services/history')
const { readSessionFacts, projectFromCwd } = require('../services/session-facts')
const { findClaudePid } = require('../services/external-process')
const { claudeEntriesToEvents } = require('../services/history-convert')
const config = require('../config/index')

function mainJsonlPath(sessionId) {
  return path.join(CLAUDE_PROJECTS_DIR, `${sessionId}.jsonl`)
}

function sendEvent(res, id, event, dataObj) {
  let line = ''
  if (id !== undefined) line += `id: ${id}\n`
  if (event) line += `event: ${event}\n`
  line += `data: ${JSON.stringify(dataObj)}\n\n`
  res.write(line)
}

router.get('/', (req, res) => {
  const raw = req.query.session
  if (!raw) {
    res.status(400).end()
    return
  }
  if (!UUID_RE.test(raw)) {
    res.status(400).json({ error: 'invalid sessionId' })
    return
  }
  const sessionId = raw
  getState(sessionId)

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')

  const s = getState(sessionId)

  // 外部会話: pocketがspawnしていないが /proc 上に claude プロセスが存在する。
  if (!s.process && findClaudePid(sessionId)) {
    const facts = readSessionFacts(sessionId)
    const project = projectFromCwd(facts.cwd, config.projects)
    const displayModel = facts.modelId ?? facts.model ?? 'default'

    // 行番号空間: id=本体jsonlの非空行番号（0-origin）。1行が複数イベントに変換されても
    // 同じ行番号を持ち、クライアントは「行番号 < lastLine」で dedup する（同一行番号の
    // グループは丸ごと通す）。行番号を消費するのは jsonl 行だけなので、pocketが走らせて
    // いる会話の行番号空間（pocketログの行）と独立して一貫する。
    let rawMainLines
    try {
      rawMainLines = fs.readFileSync(mainJsonlPath(sessionId), 'utf8').split('\n').filter(l => l.trim())
    } catch {
      rawMainLines = []
    }
    const entries = rawMainLines.map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)

    // fromLine=最後に受信した行番号。それより後の行（=行番号 >= fromLine のグループ）だけ送る。
    // fromLine=0 は全量。（A2暫定: クエリからの fromLine は解釈しない＝常に全量。A3で統一）
    const startLine = 0
    entries.forEach((entry, lineNo) => {
      if (lineNo < startLine) return
      const converted = claudeEntriesToEvents([entry])
      converted.forEach(ev => sendEvent(res, lineNo, 'history', ev))
    })
    const maxLine = Math.max(0, entries.length - 1)
    sendEvent(res, undefined, 'history-meta', { base: 0, maxLine, external: true })
    sendEvent(res, undefined, undefined, { type: 'start', project, model: displayModel, external: true })

    let lastSize = 0
    try {
      lastSize = fs.statSync(mainJsonlPath(sessionId)).size
    } catch {}
    // 末尾の不完全行はバイト列のままバッファし、改行が揃ってから toString('utf8') する
    // （マルチバイト文字の境界で分割されないようにする＝バイト長と文字長の混同防止）。
    let buffered = Buffer.alloc(0)
    // 追記分の行番号は「変換済みjsonl行数」の累積カウンタ。起動時点の行数から始める。
    let nextLineNo = entries.length

    // 新規追加分を検出して配信
    function processTail() {
      let rawMain
      try {
        rawMain = fs.readFileSync(mainJsonlPath(sessionId))
      } catch { return }
      const newBytes = rawMain.slice(lastSize)
      lastSize = rawMain.length
      buffered = Buffer.concat([buffered, newBytes])
      let nlIndex
      // 最後の不完全行はバッファに残す
      while ((nlIndex = buffered.indexOf(0x0a)) !== -1) {
        const lineBuf = buffered.slice(0, nlIndex)
        buffered = buffered.slice(nlIndex + 1)
        const line = lineBuf.toString('utf8')
        if (!line.trim()) continue
        const lineNo = nextLineNo
        try {
          const entry = JSON.parse(line)
          const converted = claudeEntriesToEvents([entry])
          // 同一 jsonl 行から変換されたイベント群は1グループ＝同じ行番号を持つ
          converted.forEach(ev => sendEvent(res, lineNo, 'history', ev))
        } catch {}
        nextLineNo++
      }
    }

    const pollInterval = setInterval(() => {
      const pid = findClaudePid(sessionId)
      if (!pid) {
        sendEvent(res, undefined, undefined, { type: 'done', exitCode: null, reason: 'external_exit' })
        _cleanupExternal()
        return
      }
      processTail()
    }, 2000)

    let watcher = null
    function _cleanupExternal() {
      clearInterval(pollInterval)
      try { watcher.close() } catch {}
    }

    try {
      watcher = fs.watch(mainJsonlPath(sessionId), () => processTail())
    } catch {}

    req.on('close', _cleanupExternal)
    return
  }

  // 暫定実装（A3で新プロトコルへ書き直す）: B（pocketログ）の全量を event: history
  // （id B<n>）で流し、history-meta は {maxA:-1, maxB} を返す。クライアントの
  // fromLine/epoch は使わない（全量送り）。外部会話分岐（上）は触らない。
  const all = loadLogFile(sessionId)
  const maxB = all.length - 1

  all.forEach((ev, i) => {
    res.write(`event: history\nid: B${i}\ndata: ${JSON.stringify(ev)}\n\n`)
  })
  res.write(`event: history-meta\ndata: ${JSON.stringify({ maxA: -1, maxB })}\n\n`)
  registerSSEClient(sessionId, res)

  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n')
    } catch {}
  }, 20000)

  req.on('close', () => {
    clearInterval(heartbeat)
    unregisterSSEClient(sessionId, res)
  })
})

module.exports = router
