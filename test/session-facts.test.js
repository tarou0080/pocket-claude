const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
// 本番の ~/.claude に触れない（CLAUDE_CONFIG_DIR を一時ディレクトリへ向ける。services の require より前に置く）。
const claudeTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-session-facts-claude-'))
process.env.CLAUDE_CONFIG_DIR = claudeTmp
test.after(() => fs.rmSync(claudeTmp, { recursive: true, force: true }))

const { _readSessionFacts, matchConfigModel, projectFromCwd, sessionExists } = require('../services/session-facts')
const { CLAUDE_PROJECTS_DIR } = require('../services/claude-dir')
fs.mkdirSync(CLAUDE_PROJECTS_DIR, { recursive: true })

function writeJsonl(dir, id, lines) {
  fs.writeFileSync(path.join(dir, `${id}.jsonl`), lines.map(l => JSON.stringify(l)).join('\n') + '\n')
}

test('readSessionFacts: 存在しないファイルは全null', () => {
  const f = _readSessionFacts(path.join(os.tmpdir(), 'pc-does-not-exist.jsonl'))
  assert.deepEqual(f, { cwd: null, modelId: null, model: null, effort: null })
})

test('readSessionFacts: cwd / modelId / last model / last effort を抽出', () => {
  const file = path.join(os.tmpdir(), `pc-facts-${process.pid}.jsonl`)
  fs.writeFileSync(file, [
    JSON.stringify({ type: 'queue-operation' }),
    JSON.stringify({ type: 'user', cwd: '/srv/shell/myapp' }),
    JSON.stringify({ type: 'assistant', message: { model: 'opus' }, effort: 'high' }),
    JSON.stringify({ attachment: { type: 'model', identity: { modelId: 'cloudflare-paid,@cf/x' } } }),
    JSON.stringify({ type: 'assistant', message: { model: '@cf/x' }, effort: 'medium' }),
  ].join('\n') + '\n')
  const f = _readSessionFacts(file)
  assert.equal(f.cwd, '/srv/shell/myapp')
  assert.equal(f.modelId, 'cloudflare-paid,@cf/x')
  assert.equal(f.model, '@cf/x')
  assert.equal(f.effort, 'medium')
  fs.unlinkSync(file)
})

test('readSessionFacts: modelId 行が無ければ null', () => {
  const file = path.join(os.tmpdir(), `pc-facts2-${process.pid}.jsonl`)
  fs.writeFileSync(file, [
    JSON.stringify({ type: 'user', cwd: '/home/user' }),
    JSON.stringify({ type: 'assistant', message: { model: 'sonnet' } }),
  ].join('\n') + '\n')
  const f = _readSessionFacts(file)
  assert.equal(f.modelId, null)
  assert.equal(f.model, 'sonnet')
  fs.unlinkSync(file)
})

test('matchConfigModel: 完全一致 > 後半マッチ', () => {
  const models = [
    { value: 'cloudflare-paid,@cf/x' },
    { value: 'cloudflare,@cf/x' },
  ]
  // modelId が前半との完全一致をとる
  assert.equal(matchConfigModel({ modelId: 'cloudflare-paid,@cf/x' }, models), 'cloudflare-paid,@cf/x')
  // modelId が後半だけなら cloudflare-paid の方を優先して返す
  assert.equal(matchConfigModel({ modelId: '@cf/x' }, models), 'cloudflare-paid,@cf/x')
  // modelId 無し、model で後半一致
  assert.equal(matchConfigModel({ model: '@cf/x' }, models), 'cloudflare-paid,@cf/x')
})

test('matchConfigModel: 該当なしは null', () => {
  const models = [{ value: 'opus' }, { value: 'sonnet' }]
  assert.equal(matchConfigModel({ model: 'unknown' }, models), null)
})

test('projectFromCwd: exact > 最長prefix', () => {
  const projects = {
    home: '/home/user',
    work: '/home/user/workspace',
  }
  assert.equal(projectFromCwd('/home/user', projects), 'home')
  assert.equal(projectFromCwd('/home/user/workspace', projects), 'work')
  assert.equal(projectFromCwd('/home/user/workspace/src', projects), 'work')
  assert.equal(projectFromCwd('/tmp', projects), null)
})

test('projectFromCwd: prefix は path.sep で区切った子だけ', () => {
  const projects = { home: '/home/userx' }
  assert.equal(projectFromCwd('/home/user', projects), null)
})

test('sessionExists: UUID jsonl が存在すれば true', () => {
  const id = 'e56b58ee-5eb9-4b9d-8771-f4f80cfa3062'
  writeJsonl(CLAUDE_PROJECTS_DIR, id, [{ type: 'user' }])
  assert.ok(sessionExists(id))
})

test('sessionExists: 存在しない UUID は false', () => {
  assert.equal(sessionExists('00000000-0000-0000-0000-000000000000'), false)
})
