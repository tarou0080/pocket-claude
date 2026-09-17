const fs = require('fs')
const path = require('path')
const express = require('express')
const router = express.Router()
const { getState, registerSSEClient, unregisterSSEClient, classifyCursor } = require('../services/stream')
const { UUID_RE, CLAUDE_PROJECTS_DIR, buildConversation } = require('../services/history')
const { readSessionFacts, projectFromCwd } = require('../services/session-facts')
const { findClaudePid } = require('../services/external-process')
const { claudeEntriesToEvents } = require('../services/history-convert')
const config = require('../config/index')

function mainJsonlPath(sessionId) {
  return path.join(CLAUDE_PROJECTS_DIR, `${sessionId}.jsonl`)
}

// id 無しのイベントは空の `id:` を送る。EventSource は直前の id を持ち越す（lastEventId）ので、
// 空 id を明示して '' へ戻さないとクライアントが id 付きと区別できない（v2.15.0 票B verify D2）。
function sendEvent(res, id, event, dataObj) {
  let line = id !== undefined ? `id: ${id}\n` : 'id:\n'
  if (event) line += `event: ${event}\n`
  line += `data: ${JSON.stringify(dataObj)}\n\n`
  res.write(line)
}

// A（本体jsonl）の assistant/user 行の uuid 集合（M再送のアンカー判定用）。
// stdout の assistant/user イベントは A の行と同じ uuid を持つ（実測）。それ以外の
// 行種（queue-operation 等）の uuid は stream_event の uuid と衝突し得るため集めない。
function collectAUuids(sessionId) {
  const set = new Set()
  let raw
  try {
    raw = fs.readFileSync(mainJsonlPath(sessionId), 'utf8')
  } catch {
    return set
  }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const entry = JSON.parse(line)
      if (entry && (entry.type === 'assistant' || entry.type === 'user') && entry.uuid != null) {
        set.add(entry.uuid)
      }
    } catch {}
  }
  return set
}

// ファイルの [start, start+length) バイトだけ読む（全読みしない）。
function readRange(p, start, length) {
  let fd = null
  try {
    fd = fs.openSync(p, 'r')
    const buf = Buffer.alloc(length)
    const read = fs.readSync(fd, buf, 0, length, start)
    return read === length ? buf : buf.slice(0, read)
  } catch {
    return null
  } finally {
    try { if (fd !== null) fs.closeSync(fd) } catch {}
  }
}

// GET /api/stream?session=<id>&fromA=<n>&fromB=<n>
// 自分の会話（pocketがspawn）も外部会話も同じ1経路。分岐は「4. の start 合成」と
// 「6. の pid 監視」だけ。
//   - fromA/fromB 省略は 0（全量）。
//   - A ＝ 本体jsonl（非空行番号 a、id: A<n>）／B ＝ pocketログ（非空行番号 b、id: B<n>）／
//     M ＝ state[id].buffer（現在ターンの stdout 生イベント・永続化しない）。
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
  const fromA = Math.max(0, parseInt(req.query.fromA, 10) || 0)
  const fromB = Math.max(0, parseInt(req.query.fromB, 10) || 0)

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')

  const s = getState(sessionId)
  // 外部会話: pocketがspawnしていないが /proc 上に claude プロセスが存在する。
  const external = !s.process && !!findClaudePid(sessionId)

  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n') } catch {}
  }, 20000)

  const { events, maxA, maxB } = buildConversation(sessionId, { fromA, fromB })

  // 1. カーソルがサーバーの履歴を追い越している（jsonl削除・セッション再利用等）なら
  //    履歴は送らずリセットだけ伝える。接続は保ち、以降は何も送らない（クライアントが
  //    カーソルを 0 に戻して張り直す）。
  if (classifyCursor({ fromA, fromB }, { maxA, maxB }) === 'reset') {
    sendEvent(res, undefined, 'history-meta', { maxA, maxB, reset: true })
    req.on('close', () => clearInterval(heartbeat))
    return
  }

  // 2. 履歴（A+B を after で織り込んだもの）: event: history / id: A<n>|B<n>
  for (const item of events) {
    sendEvent(res, item.id, 'history', item.ev)
  }

  // 3. M 再送: バッファの中で「uuid が A に存在する assistant/user イベントの最後」より
  //    後ろだけを対象にする（それより前は履歴再生で既に届いている）。対象のうち
  //    assistant/user は表示語彙へ変換して event: history（id 無し・クライアントは
  //    uuid で履歴側と照合）、それ以外の生イベント（書きかけの stream_event 等）は
  //    そのまま id 無しの無名イベントで送る。
  if (Array.isArray(s.buffer) && s.buffer.length) {
    const aUuids = collectAUuids(sessionId)
    let start = 0
    for (let i = 0; i < s.buffer.length; i++) {
      const ev = s.buffer[i]
      if ((ev.type === 'assistant' || ev.type === 'user') && ev.uuid != null && aUuids.has(ev.uuid)) {
        start = i + 1
      }
    }
    for (let i = start; i < s.buffer.length; i++) {
      const ev = s.buffer[i]
      if (ev.type === 'assistant' || ev.type === 'user') {
        for (const c of claudeEntriesToEvents([ev])) {
          if (ev.uuid != null) c.uuid = ev.uuid
          sendEvent(res, undefined, 'history', c)
        }
      } else {
        sendEvent(res, undefined, undefined, ev)
      }
    }
  }

  // 4. 外部会話は start を合成する（自分の会話の start は B の再生に含まれる）。
  if (external) {
    const facts = readSessionFacts(sessionId)
    const project = projectFromCwd(facts.cwd, config.projects)
    const displayModel = facts.modelId ?? facts.model ?? 'default'
    sendEvent(res, undefined, undefined, { type: 'start', project, model: displayModel, external: true })
  }

  // 5. カーソル境界（クライアントが次に送るべき fromA/fromB の材料）。
  sendEvent(res, undefined, 'history-meta', { maxA, maxB, external })

  // 6. 以降は源を問わず全部ライブ（無名イベント）。
  //    registerSSEClient に B の追記（broadcast・id: B<n>）と M の生イベント
  //    （emitLive・id 無し）が流れる。加えて A の追記を全セッション共通で tail する。
  registerSSEClient(sessionId, res)

  const aPath = mainJsonlPath(sessionId)
  let aExists = true
  let lastSize = 0
  // 追加行の非空行番号の起点＝既存の非空行数（再生済みの A0..A<maxA> の次）。
  let nextA = maxA + 1
  try {
    lastSize = fs.statSync(aPath).size
  } catch {
    aExists = false
    nextA = 0
  }
  // 末尾の不完全行はバイト列のままバッファし、改行が揃ってから toString('utf8') する
  // （マルチバイト文字の境界で分割されないようにする＝バイト長と文字長の混同防止）。
  let tailBuf = Buffer.alloc(0)

  function processTail() {
    let st
    try { st = fs.statSync(aPath) } catch { return } // A がまだ無い＝ポーリングで待つ
    if (!aExists) {
      // 接続後に A が現れた: 全行が新規（nextA も 0 から）
      aExists = true
      lastSize = 0
      nextA = 0
      try { if (!watcher) watcher = fs.watch(aPath, () => processTail()) } catch {}
      try { if (dirWatcher) { dirWatcher.close(); dirWatcher = null } } catch {}
    }
    if (st.size <= lastSize) return
    const newBytes = readRange(aPath, lastSize, st.size - lastSize)
    lastSize = st.size
    if (!newBytes) return
    tailBuf = Buffer.concat([tailBuf, newBytes])
    let nl
    // 最後の不完全行はバッファに残す
    while ((nl = tailBuf.indexOf(0x0a)) !== -1) {
      const lineBuf = tailBuf.slice(0, nl)
      tailBuf = tailBuf.slice(nl + 1)
      const line = lineBuf.toString('utf8')
      if (!line.trim()) continue
      const lineNo = nextA++
      try {
        const entry = JSON.parse(line)
        // buildConversation と同じく uuid を付ける（M から描いた分とクライアントが照合する）
        for (const ev of claudeEntriesToEvents([entry])) {
          sendEvent(res, `A${lineNo}`, 'history', Object.assign({ uuid: entry.uuid }, ev))
        }
      } catch {}
    }
  }

  function cleanup() {
    clearInterval(heartbeat)
    clearInterval(tailPoll)
    try { watcher.close() } catch {}
    try { dirWatcher.close() } catch {}
    unregisterSSEClient(sessionId, res)
  }

  let watcher = null
  let dirWatcher = null
  if (aExists) {
    try { watcher = fs.watch(aPath, () => processTail()) } catch {}
  } else {
    // 新規会話は最初のプロンプトで A が生まれる。2秒ポーリングだけだと CLI の user 行
    // （＝画面の「> プロンプト」）より先に M の thinking/deltas が届いて順序が狂うので、
    // 親ディレクトリを watch して生成を即拾う（実測: 新規会話で thinking が先に描かれた）。
    try {
      dirWatcher = fs.watch(path.dirname(aPath), (_evt, name) => {
        if (name === path.basename(aPath)) processTail()
      })
    } catch {}
  }

  const tailPoll = setInterval(() => {
    processTail()
    // 外部会話は pid の消滅を見て終了させる（最終行を送り切ってから done）。
    if (external && !findClaudePid(sessionId)) {
      sendEvent(res, undefined, undefined, { type: 'done', exitCode: null, reason: 'external_exit' })
      cleanup()
      // 接続を閉じてクライアントに張り直させる。閉じずに残すと watcher も SSE 登録も
      // 外れた「何も流れない接続」が生き続け、この後 pocket から送った続き（start・
      // user 行・応答）が一切届かない（実測 2026-09-17: 終了後の送信が画面に出なかった）。
      // 張り直し後は external=false の通常経路（B の broadcast＋A tail）に乗る。
      res.end()
      return
    }
  }, 2000)

  req.on('close', cleanup)
})

module.exports = router
