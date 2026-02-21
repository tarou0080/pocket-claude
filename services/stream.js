const fs = require('fs')
const path = require('path')
const config = require('../config/index')

// sessionIDごとの実行状態（メモリ）
const state = {}

// 状態取得
function getState(sessionId) {
  if (!state[sessionId]) {
    state[sessionId] = {
      process: null,
      buffer: [],
      sseClients: [],
      pendingPrompt: null,
      pendingModel: null
    }
  }
  return state[sessionId]
}

// ログファイルパス
function logFile(sessionId) {
  return path.join(config.LOGS_DIR, `${sessionId}.jsonl`)
}

// 全クライアントに配信（バッファ＋ファイルにも積む）
function broadcast(sessionId, event) {
  const s = getState(sessionId)
  s.buffer.push(event)
  fs.appendFile(logFile(sessionId), JSON.stringify(event) + '\n', () => {})
  const line = `data: ${JSON.stringify(event)}\n\n`
  s.sseClients.forEach(res => {
    try {
      res.write(line)
    } catch {}
  })
}

// ログファイルからバッファを復元
function loadLogFile(sessionId) {
  try {
    return fs.readFileSync(logFile(sessionId), 'utf8')
      .split('\n')
      .filter(l => l.trim())
      .map(l => JSON.parse(l))
  } catch {
    return []
  }
}

// SSEクライアント登録
function registerSSEClient(sessionId, res) {
  const s = getState(sessionId)
  s.sseClients.push(res)
}

// SSEクライアント削除
function unregisterSSEClient(sessionId, res) {
  const s = getState(sessionId)
  s.sseClients = s.sseClients.filter(c => c !== res)
}

// state削除（タブ削除時）
function deleteState(sessionId) {
  delete state[sessionId]
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
