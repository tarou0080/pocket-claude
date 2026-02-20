const fs = require('fs')
const path = require('path')
const config = require('../config/index')

// タブIDごとの実行状態（メモリ）
const state = {}

// 状態取得
function getState(tabId) {
  if (!state[tabId]) {
    state[tabId] = {
      process: null,
      buffer: [],
      sseClients: [],
      pendingPrompt: null,
      pendingModel: null
    }
  }
  return state[tabId]
}

// ログファイルパス
function logFile(tabId) {
  return path.join(config.LOGS_DIR, `${tabId}.jsonl`)
}

// 全クライアントに配信（バッファ＋ファイルにも積む）
function broadcast(tabId, event) {
  const s = getState(tabId)
  s.buffer.push(event)
  fs.appendFile(logFile(tabId), JSON.stringify(event) + '\n', () => {})
  const line = `data: ${JSON.stringify(event)}\n\n`
  s.sseClients.forEach(res => {
    try {
      res.write(line)
    } catch {}
  })
}

// ログファイルからバッファを復元
function loadLogFile(tabId) {
  try {
    return fs.readFileSync(logFile(tabId), 'utf8')
      .split('\n')
      .filter(l => l.trim())
      .map(l => JSON.parse(l))
  } catch {
    return []
  }
}

// SSEクライアント登録
function registerSSEClient(tabId, res) {
  const s = getState(tabId)
  s.sseClients.push(res)
}

// SSEクライアント削除
function unregisterSSEClient(tabId, res) {
  const s = getState(tabId)
  s.sseClients = s.sseClients.filter(c => c !== res)
}

// state削除（タブ削除時）
function deleteState(tabId) {
  delete state[tabId]
}

module.exports = {
  getState,
  broadcast,
  loadLogFile,
  registerSSEClient,
  unregisterSSEClient,
  deleteState,
  logFile
}
