const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const express = require('express')
const { randomUUID } = require('crypto')
const claudeRoutes = require('../routes/claude')
const { saveClaudeSessionId, forgetSession } = require('../services/sessions')
const { getState, deleteState } = require('../services/stream')

// GET /api/resolve-session/:claudeSessionId は履歴一覧のID(Claude session ID)から、
// 走っている本体の pocket session ID を引く逆引き。履歴から実行中の会話を開いたときに
// 別IDの新しいタブ(=本体と繋がらない影のタブ)を作らないための土台なので、
// UUID_RE検証・存在しないIDの扱い・生きているものが優先される分岐をルートレベルで確認する。

const sessionsDir = path.join(__dirname, '..', 'sessions')
function cleanup(sessionId) {
  try { fs.unlinkSync(path.join(sessionsDir, `${sessionId}.json`)) } catch {}
  forgetSession(sessionId)
  deleteState(sessionId)
}

function withServer(t) {
  const app = express()
  app.use(express.json())
  app.use('/api', claudeRoutes)
  const server = app.listen(0)
  t.after(() => server.close())
  const { port } = server.address()
  return `http://127.0.0.1:${port}`
}

test('不正な形式のclaudeSessionIdは400', async (t) => {
  const base = withServer(t)
  const res = await fetch(`${base}/api/resolve-session/${encodeURIComponent('../etc/passwd')}`)
  assert.equal(res.status, 400)
})

test('紐づくpocketセッションが無ければ200かつpocketSessionId:null', async (t) => {
  const base = withServer(t)
  const claudeSessionId = randomUUID()
  const res = await fetch(`${base}/api/resolve-session/${claudeSessionId}`)
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.deepEqual(body, { pocketSessionId: null, running: false, alive: false })
})

test('実在するClaude session IDをpocket session IDへ逆引きできる', async (t) => {
  const base = withServer(t)
  const pocketId = randomUUID()
  const claudeId = randomUUID()
  t.after(() => cleanup(pocketId))

  saveClaudeSessionId(pocketId, claudeId)
  const res = await fetch(`${base}/api/resolve-session/${claudeId}`)
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.pocketSessionId, pocketId)
})

test('複数候補があっても生きている方が優先される（最終更新の新旧に関わらず）', async (t) => {
  const base = withServer(t)
  const claudeId = randomUUID()
  const oldPocketId = randomUUID()
  const newPocketId = randomUUID()
  t.after(() => { cleanup(oldPocketId); cleanup(newPocketId) })

  saveClaudeSessionId(oldPocketId, claudeId)
  // 明示的にoldPocketIdのファイルを古い日時にし、newPocketIdを新しい日時にする
  // (新しい順に並べても、生きている判定がその順序に優先することを確認するため)
  const past = new Date(Date.now() - 60_000)
  fs.utimesSync(path.join(sessionsDir, `${oldPocketId}.json`), past, past)
  saveClaudeSessionId(newPocketId, claudeId)

  // oldPocketIdだけ「生きている」ことにする(実プロセスは起動しない・processに真値を置くだけ)
  getState(oldPocketId).process = { pid: 1 }
  getState(oldPocketId).turning = true

  const res = await fetch(`${base}/api/resolve-session/${claudeId}`)
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.deepEqual(body, { pocketSessionId: oldPocketId, running: true, alive: true })
})
