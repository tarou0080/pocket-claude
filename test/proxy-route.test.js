const test = require('node:test')
const assert = require('node:assert/strict')
const { getProxyEnv, proxyRouteChanged, getToolFlags } = require('../services/proxy-route')

// バグの実体: qwen(proxyModels経由)→opus(直Claude)の切替でset_modelが成功してしまい、
// ANTHROPIC_BASE_URL等のenvがプロキシを向いたまま残った（プロセスenvは起動時固定のため）。
// routes/claude.js はここを見て「set_modelを試すか、最初からkill+resume再起動するか」を
// 決めるので、その判定の中身をservices/spawner.jsのstartClaudeと同じ引き方で検証する。

const fakeConfig = {
  proxyModels: {
    'ollama,qwen3.5-9b-q4-nothink': { ANTHROPIC_BASE_URL: 'http://127.0.0.1:3456', ANTHROPIC_API_KEY: 'local-ccr-key' },
    '@cf/nvidia/nemotron-3-120b-a12b': { ANTHROPIC_BASE_URL: 'http://127.0.0.1:3456', ANTHROPIC_API_KEY: 'local-ccr-key' },
  },
}

test('プロキシモデルのenvを取得できる', () => {
  assert.deepEqual(
    getProxyEnv(fakeConfig, 'ollama,qwen3.5-9b-q4-nothink'),
    { ANTHROPIC_BASE_URL: 'http://127.0.0.1:3456', ANTHROPIC_API_KEY: 'local-ccr-key' }
  )
})

test('proxyModelsに無いモデル(直Claude)はnull', () => {
  assert.equal(getProxyEnv(fakeConfig, 'opus'), null)
  assert.equal(getProxyEnv(fakeConfig, null), null)
})

test('qwen(プロキシ)→opus(直Claude)はプロキシ経路が変わる＝再起動が必要', () => {
  assert.equal(proxyRouteChanged(fakeConfig, 'ollama,qwen3.5-9b-q4-nothink', 'opus'), true)
})

test('opus(直Claude)→qwen(プロキシ)もプロキシ経路が変わる＝再起動が必要', () => {
  assert.equal(proxyRouteChanged(fakeConfig, 'opus', 'ollama,qwen3.5-9b-q4-nothink'), true)
})

test('直Claude同士(sonnet→opus)はプロキシ経路が変わらない＝set_modelでよい', () => {
  assert.equal(proxyRouteChanged(fakeConfig, 'sonnet', 'opus'), false)
})

test('同じプロキシモデル同士(envが同一)はプロキシ経路が変わらない＝set_modelでよい', () => {
  assert.equal(proxyRouteChanged(
    fakeConfig,
    'ollama,qwen3.5-9b-q4-nothink',
    '@cf/nvidia/nemotron-3-120b-a12b'
  ), false)
})

test('null(既定)からモデル名なし(既定)への変化なしはプロキシ経路も変わらない', () => {
  assert.equal(proxyRouteChanged(fakeConfig, null, null), false)
})

// ツール構成はallowlist方式(toolsDirect/toolsProxy)。どちらも未設定なら絞らない。
// 見るキーはproxyEnvの有無(=プロキシ経由セッションかどうか)で決まる。

test('toolsDirect/toolsProxyとも未設定なら tools は渡さず disallowedTools は AskUserQuestion のみ', () => {
  assert.deepEqual(getToolFlags(fakeConfig, null), { tools: null, disallowedTools: ['AskUserQuestion'] })
  const proxyEnv = getProxyEnv(fakeConfig, 'ollama,qwen3.5-9b-q4-nothink')
  assert.deepEqual(getToolFlags(fakeConfig, proxyEnv), { tools: null, disallowedTools: ['AskUserQuestion'] })
})

test('toolsProxy設定時、プロキシ経由セッションではそのallowlistになる', () => {
  const configWithTools = { ...fakeConfig, toolsProxy: ['Bash', 'Edit', 'Read', 'Write', 'WebFetch'] }
  const proxyEnv = getProxyEnv(configWithTools, 'ollama,qwen3.5-9b-q4-nothink')
  assert.deepEqual(getToolFlags(configWithTools, proxyEnv), {
    tools: ['Bash', 'Edit', 'Read', 'Write', 'WebFetch'],
    disallowedTools: ['AskUserQuestion'],
  })
})

test('toolsProxyを設定してもClaude直セッション(proxyEnvなし)には影響しない(toolsDirectを見る)', () => {
  const configWithTools = { ...fakeConfig, toolsProxy: ['Bash', 'Edit', 'Read', 'Write', 'WebFetch'] }
  assert.deepEqual(getToolFlags(configWithTools, null), { tools: null, disallowedTools: ['AskUserQuestion'] })
})

test('allowlistにAskUserQuestionが混ざっていたら除去される', () => {
  const configWithTools = { ...fakeConfig, toolsDirect: ['Bash', 'AskUserQuestion', 'Read'] }
  assert.deepEqual(getToolFlags(configWithTools, null), {
    tools: ['Bash', 'Read'],
    disallowedTools: ['AskUserQuestion'],
  })
})

test('空配列([])は全ツール無効という明示的な意思としてそのまま返す', () => {
  const configWithTools = { ...fakeConfig, toolsDirect: [] }
  assert.deepEqual(getToolFlags(configWithTools, null), { tools: [], disallowedTools: ['AskUserQuestion'] })
})
