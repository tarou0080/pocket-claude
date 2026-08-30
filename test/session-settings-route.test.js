const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('http')
const fs = require('fs')
const path = require('path')
const express = require('express')
const { randomUUID } = require('crypto')
const claudeRoutes = require('../routes/claude')
const { saveSessionSettings } = require('../services/sessions')

// GET /api/session-settings/:sessionId は履歴からの復帰時にmodel/effort/thinkingを
// 端末の既定値でなくセッションの最終使用設定へ引き継ぐための読み取り専用エンドポイント。
// UUID_RE検証とgetSessionSettingsへの単純な委譲だけなので、実サーバーを立てて素通しを確認する。

const sessionsDir = path.join(__dirname, '..', 'sessions')
function cleanup(sessionId) {
  try { fs.unlinkSync(path.join(sessionsDir, `${sessionId}.json`)) } catch {}
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

test('不正な形式のsessionIdは400', async (t) => {
  const base = withServer(t)
  const res = await fetch(`${base}/api/session-settings/${encodeURIComponent('../etc/passwd')}`)
  assert.equal(res.status, 400)
})

test('保存済みの設定がある場合はそのまま返す', async (t) => {
  const base = withServer(t)
  const sessionId = randomUUID()
  t.after(() => cleanup(sessionId))
  saveSessionSettings(sessionId, { project: 'home', model: 'ollama,qwen3.5-9b-q4-nothink', effort: 'high', thinking: true })

  const res = await fetch(`${base}/api/session-settings/${sessionId}`)
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.deepEqual(body, { project: 'home', model: 'ollama,qwen3.5-9b-q4-nothink', effort: 'high', thinking: true })
})

test('存在しないセッションはエラーにせず全nullを返す（既存挙動）', async (t) => {
  const base = withServer(t)
  const sessionId = randomUUID()
  const res = await fetch(`${base}/api/session-settings/${sessionId}`)
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.deepEqual(body, { project: null, model: null, effort: null, thinking: null })
})
