const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('http')
const fs = require('fs')
const path = require('path')
const express = require('express')
const { randomUUID } = require('crypto')
const claudeRoutes = require('../routes/claude')

// GET /api/session-settings/:sessionId は 本体jsonlから導出した事実を返す。
// テスト用に一時 jsonl を作り、fact の読み取りと model/effort/project の解決を確認する。

function withServer(t) {
  const app = express()
  app.use(express.json())
  app.use('/api', claudeRoutes)
  const server = app.listen(0)
  t.after(() => server.close())
  const { port } = server.address()
  return `http://127.0.0.1:${port}`
}

function writeMainJsonl(id, lines) {
  const dir = require('../services/claude-dir').CLAUDE_PROJECTS_DIR
  fs.writeFileSync(path.join(dir, `${id}.jsonl`), lines.map(l => JSON.stringify(l)).join('\n') + '\n')
}

function cleanupMainJsonl(id) {
  const dir = require('../services/claude-dir').CLAUDE_PROJECTS_DIR
  try { fs.unlinkSync(path.join(dir, `${id}.jsonl`)) } catch {}
}

test('不正な形式のsessionIdは400', async (t) => {
  const base = withServer(t)
  const res = await fetch(`${base}/api/session-settings/${encodeURIComponent('../etc/passwd')}`)
  assert.equal(res.status, 400)
})

test('本体jsonlから project/model/effort を解決して返す', async (t) => {
  const base = withServer(t)
  const id = randomUUID()
  t.after(() => cleanupMainJsonl(id))
  writeMainJsonl(id, [
    { type: 'user', cwd: '/home/johnadmin' },
    { type: 'assistant', message: { model: '@cf/moonshotai/kimi-k2.7-code' }, effort: 'medium' },
  ])

  const res = await fetch(`${base}/api/session-settings/${id}`)
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.project, 'home')
  assert.equal(body.model, 'cloudflare-paid,@cf/moonshotai/kimi-k2.7-code')
  assert.equal(body.modelResolved, '@cf/moonshotai/kimi-k2.7-code')
  assert.equal(body.effort, 'medium')
})

test('存在しないセッションはエラーにならず null で返す（既存挙動）', async (t) => {
  const base = withServer(t)
  const id = randomUUID()
  const res = await fetch(`${base}/api/session-settings/${id}`)
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.project, null)
  assert.equal(body.model, null)
  assert.equal(body.effort, null)
})
