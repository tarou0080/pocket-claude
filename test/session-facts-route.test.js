const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('http')
const fs = require('fs')
const path = require('path')
const express = require('express')
const os = require('os')
const { randomUUID } = require('crypto')

// 本体jsonlは本番の ~/.claude でなく一時ディレクトリへ書く（CLAUDE_CONFIG_DIR をモジュール読込前に向ける）
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-facts-route-'))
process.env.CLAUDE_CONFIG_DIR = path.join(tmpRoot, 'claude')
test.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }))
const claudeRoutes = require('../routes/claude')
const config = require('../config/index')
const { projectDirFor } = require('../services/claude-dir')
const HOME_CWD = path.join(tmpRoot, 'home')

// 解決先の models/projects は稼働中の config.json に依存させず、テストで注入する
// （本番の config.json からモデルを撤去したらテストが落ちた・2026-09-21）。
function withConfig(t, patch) {
  const prev = {}
  for (const k of Object.keys(patch)) { prev[k] = config[k]; config[k] = patch[k] }
  t.after(() => { for (const k of Object.keys(prev)) config[k] = prev[k] })
}

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
  const dir = projectDirFor(HOME_CWD)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${id}.jsonl`), lines.map(l => JSON.stringify(l)).join('\n') + '\n')
}

function cleanupMainJsonl(id) {
  const dir = projectDirFor(HOME_CWD)
  try { fs.unlinkSync(path.join(dir, `${id}.jsonl`)) } catch {}
}

test('不正な形式のsessionIdは400', async (t) => {
  const base = withServer(t)
  const res = await fetch(`${base}/api/session-settings/${encodeURIComponent('../etc/passwd')}`)
  assert.equal(res.status, 400)
})

test('本体jsonlから project/model/effort を解決して返す', async (t) => {
  withConfig(t, {
    models: [{ value: 'test-provider,@test/model-x', label: 'Test X' }],
    projects: { home: HOME_CWD },
  })
  const base = withServer(t)
  const id = randomUUID()
  t.after(() => cleanupMainJsonl(id))
  writeMainJsonl(id, [
    { type: 'user', cwd: HOME_CWD },
    { type: 'assistant', message: { model: '@test/model-x' }, effort: 'medium' },
  ])

  const res = await fetch(`${base}/api/session-settings/${id}`)
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.project, 'home')
  assert.equal(body.model, 'test-provider,@test/model-x')
  assert.equal(body.modelResolved, '@test/model-x')
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
