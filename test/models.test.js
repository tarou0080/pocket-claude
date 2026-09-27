const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
// 本番の ~/.claude・logs に触れない（services の require より前に置く）。
const claudeTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-models-claude-'))
process.env.CLAUDE_CONFIG_DIR = claudeTmp
const logsTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-models-logs-'))
test.after(() => {
  fs.rmSync(claudeTmp, { recursive: true, force: true })
  fs.rmSync(logsTmp, { recursive: true, force: true })
})

const config = require('../config/index')
const models = require('../services/models')

function reset(list) {
  models._facts.clear()
  config.models = list
  config.LOGS_DIR = logsTmp
  for (const f of fs.readdirSync(logsTmp)) fs.unlinkSync(path.join(logsTmp, f))
}
function writeLog(id, events) {
  fs.writeFileSync(path.join(logsTmp, `${id}.jsonl`), events.map(e => JSON.stringify(e)).join('\n') + '\n')
}
const LIST = [
  { value: '', name: 'Default' },
  { value: 'opus', name: 'Opus' },
  { value: 'claude-opus-5-5', name: 'Opus 5.5' },
  { value: 'sonnet', name: 'Sonnet' },
]

test('config.models が無ければ既定の一覧を返す', () => {
  reset(undefined)
  assert.deepEqual(models.listModels().map(m => m.value), ['', 'fable', 'opus', 'sonnet', 'haiku'])
})

test('名前は config のまま・事実は選択値ごとに添える（取り違えない）', () => {
  reset(LIST)
  models.noteResolved('opus', 'claude-opus-5-5')
  models.noteResolved('sonnet', 'claude-sonnet-5')
  models.noteResolved('', '<synthetic>')
  const byValue = Object.fromEntries(models.listModels().map(m => [m.value, m]))
  assert.equal(byValue.opus.name, 'Opus')
  assert.equal(byValue.opus.resolved, 'claude-opus-5-5')
  assert.equal(byValue['claude-opus-5-5'].name, 'Opus 5.5')
  assert.equal(byValue['claude-opus-5-5'].resolved, undefined)
  assert.equal(byValue[''].resolved, undefined)
})

test('noteUsage: 解決先の窓を優先し、無ければ最大', () => {
  reset(LIST)
  models.noteResolved('opus', 'claude-opus-5-5')
  models.noteUsage('opus', { 'claude-opus-5-5': { contextWindow: 1000000 }, 'claude-haiku-4-5': { contextWindow: 200000 } })
  models.noteUsage('sonnet', { a: { contextWindow: 200000 }, b: { contextWindow: 1000000 } })
  const byValue = Object.fromEntries(models.listModels().map(m => [m.value, m]))
  assert.equal(byValue.opus.contextWindow, 1000000)
  assert.equal(byValue.sonnet.contextWindow, 1000000)
})

test('seedFromLogs: start→init・result を組にし、新しいログが勝つ。Default は "default"', () => {
  reset(LIST)
  writeLog('11111111-1111-4111-8111-111111111111', [
    { type: 'start', model: 'opus' },
    { type: 'system', subtype: 'init', model: 'claude-opus-5' },
  ])
  const old = new Date(Date.now() - 60000)
  fs.utimesSync(path.join(logsTmp, '11111111-1111-4111-8111-111111111111.jsonl'), old, old)
  writeLog('22222222-2222-4222-8222-222222222222', [
    { type: 'start', model: 'opus' },
    { type: 'system', subtype: 'init', model: 'claude-opus-5-5' },
    { type: 'result', modelUsage: { 'claude-opus-5-5': { contextWindow: 1000000 } } },
    { type: 'start', model: 'default' },
    { type: 'system', subtype: 'init', model: 'claude-sonnet-5' },
  ])
  models.seedFromLogs()
  const byValue = Object.fromEntries(models.listModels().map(m => [m.value, m]))
  assert.equal(byValue.opus.resolved, 'claude-opus-5-5')
  assert.equal(byValue.opus.contextWindow, 1000000)
  assert.equal(byValue[''].resolved, 'claude-sonnet-5')
})

test('sessionModel: 起動時に渡した値を最優先（opus と固定IDを区別する）', () => {
  reset(LIST)
  models.noteResolved('opus', 'claude-opus-5-5')
  const id = '33333333-3333-4333-8333-333333333333'
  writeLog(id, [{ type: 'start', model: 'opus' }])
  assert.equal(models.sessionModel(id, { modelId: 'claude-opus-5-5', model: 'claude-opus-5-5' }), 'opus')
  writeLog(id, [{ type: 'start', model: 'claude-opus-5-5' }])
  assert.equal(models.sessionModel(id, { modelId: 'claude-opus-5-5', model: 'claude-opus-5-5' }), 'claude-opus-5-5')
})

test('sessionModel: 起動後に set_model で変えた会話は最後の応答モデルから引く', () => {
  reset(LIST)
  models.noteResolved('opus', 'claude-opus-5-5')
  models.noteResolved('sonnet', 'claude-sonnet-5')
  const id = '44444444-4444-4444-8444-444444444444'
  writeLog(id, [{ type: 'start', model: 'opus' }])
  assert.equal(models.sessionModel(id, { modelId: 'claude-opus-5-5', model: 'claude-sonnet-5' }), 'sonnet')
})

test('sessionModel: 事実ログの無い外部会話は本体jsonlの値で一致を取る', () => {
  reset([...LIST, { value: 'cloudflare,@cf/x', name: 'X' }])
  const id = '55555555-5555-4555-8555-555555555555'
  assert.equal(models.sessionModel(id, { modelId: 'cloudflare,@cf/x', model: '@cf/x' }), 'cloudflare,@cf/x')
  assert.equal(models.sessionModel(id, { modelId: null, model: null }), null)
})

test('seedFromLogs: 会話内の /model で変わったモデルは起動時の選択値に付けない', () => {
  reset(LIST)
  writeLog('66666666-6666-4666-8666-666666666666', [
    { type: 'start', model: 'default' },
    { type: 'system', subtype: 'init', model: 'claude-sonnet-5' },
    { type: 'result', modelUsage: { 'claude-sonnet-5': { contextWindow: 1000000 } } },
    { type: 'system', subtype: 'init', model: 'claude-opus-5-5' },
    { type: 'result', modelUsage: { 'claude-opus-5-5': { contextWindow: 2000000 } } },
    { type: 'system', subtype: 'init', model: 'claude-opus-5-5' },
  ])
  models.seedFromLogs()
  const d = models.listModels().find(m => m.value === '')
  assert.equal(d.resolved, 'claude-sonnet-5')
  assert.equal(d.contextWindow, 1000000)
})
