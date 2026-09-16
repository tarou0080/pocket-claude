const fs = require('fs')
const path = require('path')
const express = require('express')
const router = express.Router()
const { getState, loadLogFile, registerSSEClient, unregisterSSEClient, getLineBase, classifyCursor, EPOCH } = require('../services/stream')
const { UUID_RE, CLAUDE_PROJECTS_DIR } = require('../services/history')
const { readSessionFacts, matchConfigModel, projectFromCwd } = require('../services/session-facts')
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

function mainEventsForSession(sessionId) {
  let rawLines
  try {
    rawLines = fs.readFileSync(mainJsonlPath(sessionId), 'utf8').split('\n').filter(l => l.trim())
  } catch {
    rawLines = []
  }
  const entries = rawLines.map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  return claudeEntriesToEvents(entries)
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

  let fromLine = Math.max(0, parseInt(req.query.fromLine, 10) || 0)
  const lastEventIdHeader = req.headers['last-event-id']
  let reqEpoch
  if (!req.query.fromLine && lastEventIdHeader) {
    const parsed = parseInt(lastEventIdHeader, 10)
    if (!isNaN(parsed)) fromLine = parsed + 1
  } else {
    const parsedEpoch = parseInt(req.query.epoch, 10)
    reqEpoch = isNaN(parsedEpoch) ? undefined : parsedEpoch
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')

  const s = getState(sessionId)

  // 外部会話: pocketがspawnしていないが /proc 上に claude プロセスが存在する。
  if (!s.process && findClaudePid(sessionId)) {
    const facts = readSessionFacts(sessionId)
    const project = projectFromCwd(facts.cwd, config.projects)
    const model = matchConfigModel(facts, config.models)

    const events = mainEventsForSession(sessionId)
    if (fromLine === 0) {
      events.forEach((ev, i) => sendEvent(res, i, 'history', ev))
    } else {
      // fromLine に対応するエントリが events の何番目かを探す（id=line index）。
      events.forEach((ev, i) => { if (i >= fromLine) sendEvent(res, i, 'history', ev) })
    }
    const maxLine = Math.max(0, events.length - 1)
    sendEvent(res, undefined, 'history-meta', { base: 0, maxLine, external: true })
    sendEvent(res, undefined, undefined, { type: 'start', project, model: facts.model, external: true })

    let watcher = null
    let lastSize = 0
    try {
      lastSize = fs.statSync(mainJsonlPath(sessionId)).size
    } catch {}
    let buffered = ''

    // 新規追加分を検出して配信
    function processTail() {
      let rawMain
      try {
        rawMain = fs.readFileSync(mainJsonlPath(sessionId), 'utf8')
      } catch { return }
      buffered += rawMain.slice(lastSize)
      lastSize = rawMain.length
      const parts = buffered.split('\n')
      // 最後の不完全行は次回に連結
      buffered = parts.pop()
      parts.forEach((part, idx) => {
        if (!part.trim()) return
        try {
          const entry = JSON.parse(part)
          // 変換結果を 1件ずつ event: history で送る
          const converted = claudeEntriesToEvents([entry])
          converted.forEach((ev, ci) => {
            const globalIdx = events.length + idx + ci
            sendEvent(res, globalIdx, 'history', ev)
          })
        } catch {}
      })
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

  const all = loadLogFile(sessionId)
  const base = getLineBase(sessionId, all.length)
  const maxLine = base + all.length - 1

  const status = classifyCursor({ epoch: reqEpoch, fromLine }, { epoch: EPOCH, base, maxLine })
  if (status === 'reset') {
    res.write(`event: history-meta\ndata: ${JSON.stringify({ epoch: EPOCH, base, maxLine, reset: true })}\n\n`)
  } else {
    all.forEach((ev, i) => {
      const id = base + i
      if (id >= fromLine) res.write(`event: history\nid: ${id}\ndata: ${JSON.stringify(ev)}\n\n`)
    })
    res.write(`event: history-meta\ndata: ${JSON.stringify({ epoch: EPOCH, base, maxLine })}\n\n`)
  }
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
