const test = require('node:test')
const assert = require('node:assert/strict')
const { getProxyEnv, proxyRouteChanged } = require('../services/proxy-route')

// バグの実体: qwen(proxyModels経由)→opus(直Claude)の切替でset_modelが成功してしまい、
// ANTHROPIC_BASE_URL等のenvがプロキシを向いたまま残った（プロセスenvは起動時固定のため）。
// routes/claude.js はここを見て「set_modelを試すか、最初からkill+resume再起動するか」を
// 決めるので、その判定の中身をservices/spawner.jsのstartClaudeと同じ引き方で検証する。

const fakeConfig = {
  proxyModels: {
    'ollama,qwen3.5-9b-q4-nothink': { ANTHROPIC_BASE_URL: 'http://10.88.88.1:3456', ANTHROPIC_API_KEY: 'local-ccr-key' },
    '@cf/nvidia/nemotron-3-120b-a12b': { ANTHROPIC_BASE_URL: 'http://10.88.88.1:3456', ANTHROPIC_API_KEY: 'local-ccr-key' },
  },
}

test('プロキシモデルのenvを取得できる', () => {
  assert.deepEqual(
    getProxyEnv(fakeConfig, 'ollama,qwen3.5-9b-q4-nothink'),
    { ANTHROPIC_BASE_URL: 'http://10.88.88.1:3456', ANTHROPIC_API_KEY: 'local-ccr-key' }
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
