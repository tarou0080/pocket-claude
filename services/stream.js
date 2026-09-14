const fs = require('fs')
const path = require('path')
const config = require('../config/index')

// 1セッションあたりのメモリ内バッファ上限。常駐プロセス＋長時間セッションで
// buffer が単調増加しメモリを食い潰すのを防ぐ。超過分は古いものから捨てる
// （完全な履歴はログファイルに残るため、再接続時の復元はそちらが担う）
const MAX_BUFFER = 5000

// sessionIDごとの実行状態（メモリ）
const state = {}

// 行番号カウンタ（セッションIDごとのログファイル行インデックス）
const lineCounts = {}

// 次の行インデックスを返し、カウンタをインクリメントする。
// 初回呼び出し時はファイルの現在行数で初期化する（サーバー再起動後も継続できる）。
function nextLineId(sessionId) {
  if (lineCounts[sessionId] === undefined) {
    const events = loadLogFile(sessionId)
    lineCounts[sessionId] = events.length
  }
  const id = lineCounts[sessionId]
  lineCounts[sessionId]++
  return id
}

// 状態の覗き見（getState と違い、無ければ作らない）。
// 「このセッションは今動いているか」を候補分だけ問い合わせる用途で、
// 存在しないIDのぶんまで state を生やさないために分けている。
function peekState(sessionId) {
  return state[sessionId] || null
}

// 状態取得
function getState(sessionId) {
  if (!state[sessionId]) {
    state[sessionId] = {
      process: null,
      turning: false,
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
  if (event.type === 'user_input') s.turning = true
  else if (event.type === 'result' || event.type === 'done' || event.type === 'error') s.turning = false
  s.buffer.push(event)
  if (s.buffer.length > MAX_BUFFER) s.buffer.splice(0, s.buffer.length - MAX_BUFFER)
  // 行IDを取得してからファイルに追記する（id=そのイベントが占める行インデックス）。
  // appendFileSync で同期化することで、history 読み出し（readFileSync）時に
  // 必ず最新行まで反映されている状態を保証する（read-then-subscribe の取りこぼし/重複排除）
  const id = nextLineId(sessionId)
  fs.appendFileSync(logFile(sessionId), JSON.stringify(event) + '\n')
  const line = `id: ${id}\ndata: ${JSON.stringify(event)}\n\n`
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

// pocketライブログを破棄する（v2.12.0 有限化、v2.12.1でターン跨ぎにも拡大）。会話の正典は
// 本体jsonl側にあり、再生時は getSessionEvents が本体jsonlを変換して復元するため、
// ターン完了後のライブログは冗長になる。行番号カウンタ（lineCounts）は巻き戻さない：
// クライアントの dedup は lineId <= 直近受信行 で捨てるため、ここでリセットすると
// 破棄直後の次ターンが id 0 から届いて（stale扱いで）全部捨てられる。ファイルだけ消し、
// 次に開いたファイルの行0が全体の行番号空間で何行目に当たるかは getLineBase が引き継ぐ。
function discardPocketLog(sessionId) {
  try { fs.unlinkSync(logFile(sessionId)) } catch {}
}

// GET /api/stream 用: 現在のログファイル（discardPocketLog後に作り直されたもの）の
// 行0が、セッション全体の行番号空間で何行目に当たるかを返す。lineCounts は破棄で
// 巻き戻らない（上記）ため、通常は fileLength より大きい。未初期化（サーバー再起動直後
// など、このセッションでまだ一度も broadcast/nextLineId が走っていない）場合は
// nextLineId と同じ基準（ファイル長）で初期化し、base=0 として返す。
function getLineBase(sessionId, fileLength) {
  if (lineCounts[sessionId] === undefined) lineCounts[sessionId] = fileLength
  return lineCounts[sessionId] - fileLength
}

module.exports = {
  getState,
  peekState,
  broadcast,
  loadLogFile,
  registerSSEClient,
  unregisterSSEClient,
  deleteState,
  discardPocketLog,
  getLineBase,
  logFile,
}
