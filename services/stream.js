const fs = require('fs')
const path = require('path')
const config = require('../config/index')

// 1セッションあたりのメモリ内バッファ上限。常駐プロセス＋長時間セッションで
// buffer が単調増加しメモリを食い潰すのを防ぐ。超過分は古いものから捨てる
// （完全な履歴はログファイルに残るため、再接続時の復元はそちらが担う）
const MAX_BUFFER = 5000

// プロセス世代（v2.12.2）。サーバー起動のたびに変わる定数。行番号空間（lineCounts）は
// サーバー再起動で0から振り直されるため、クライアントが古いepochのfromLineを送ってきた
// ら「その行番号空間はもう存在しない」と判定できる（IMAP UIDVALIDITY相当）。
const EPOCH = Date.now()

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
  // 安全網（v2.12.2）: pocketログの寿命＝claudeプロセスの寿命になったため、本来は
  // spawner.js が spawn直前／stdin書き込み直前に明示的にensurePocketLogを呼んで
  // log_start境界を確定させる。呼び漏れた経路があっても、ここで最低限ファイルが
  // 作られる（mainLinesの境界だけは呼び漏れると不正確になり得る＝二重描画の恐れは残るが、
  // 行番号空間が壊れることは無い）。
  ensurePocketLog(sessionId)
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

// pocketライブログを破棄する（v2.12.0 有限化。v2.12.1でターン跨ぎにも拡大したが、
// 切断中に終わったターンが復帰時に取りこぼれる回帰を招いたため v2.12.2 で撤回、
// 寿命＝claudeプロセスの寿命に戻した。呼び出し元は spawner.js の proc close のみ）。
// 会話の正典は本体jsonl側にあり、再生時は getSessionEvents が本体jsonlを変換して復元
// するため、プロセス終了後のライブログは冗長になる。行番号カウンタ（lineCounts）は
// 巻き戻さない：クライアントの dedup は lineId <= 直近受信行 で捨てるため、ここで
// リセットすると破棄直後の次ターンが id 0 から届いて（stale扱いで）全部捨てられる。
// ファイルだけ消し、次に開いたファイルの行0が全体の行番号空間で何行目に当たるかは
// getLineBase が引き継ぐ。
function discardPocketLog(sessionId) {
  try { fs.unlinkSync(logFile(sessionId)) } catch {}
}

// pocketログファイルが無ければ作る（v2.12.2）。log_start 行＝「このpocketログの行0は
// 本体jsonlの何行目(mainLines)から続きか」という境界情報。getSessionEvents はこれを見て
// 本体jsonlのどこまでを再生済みとして読み飛ばすかを決める（cutCurrentTurnのテキスト
// 照合に代わる仕組み）。broadcast と同じ経路（nextLineId採番→appendFileSync→SSE配信）で
// 直接書く：broadcast() を呼ぶと broadcast 冒頭の ensurePocketLog 安全網と相互再帰するため、
// ここでは broadcast を呼ばない。
function ensurePocketLog(sessionId) {
  if (fs.existsSync(logFile(sessionId))) return
  const { CLAUDE_PROJECTS_DIR } = require('./history')
  let mainLines = 0
  try {
    mainLines = fs.readFileSync(path.join(CLAUDE_PROJECTS_DIR, `${sessionId}.jsonl`), 'utf8')
      .split('\n')
      .filter(l => l.trim())
      .length
  } catch {}
  const event = { type: 'log_start', mainLines, epoch: EPOCH, timestamp: new Date().toISOString() }
  const s = getState(sessionId)
  const id = nextLineId(sessionId)
  fs.appendFileSync(logFile(sessionId), JSON.stringify(event) + '\n')
  const line = `id: ${id}\ndata: ${JSON.stringify(event)}\n\n`
  s.sseClients.forEach(res => {
    try { res.write(line) } catch {}
  })
}

// カーソル（クライアントが送ってきた {epoch, fromLine}）がサーバーの現在状態
// {epoch, base, maxLine} に対して有効か判定する純関数（v2.12.2）。
//  - fromLine===0 は「何も持っていない、全部くれ」＝常に ok（epoch不一致でも reset にしない）
//  - epoch指定あり かつ 現epochと不一致 → reset（サーバー再起動を跨いだ古いカーソル）
//  - 0 < fromLine < base → reset（該当行はpocketログ有限化で既に失われている）
//  - fromLine > maxLine + 1 → reset（未来の行番号＝再起動後の行番号巻き戻り等でサーバーの
//    行数を追い越している。従来はクライアント側の getLastLine > maxLine 比較で検出していた
//    ものをサーバー側の判定へ寄せた）
function classifyCursor(cursor, meta) {
  const { fromLine } = cursor
  if (fromLine === 0) return 'ok'
  const { epoch: reqEpoch } = cursor
  const { epoch, base, maxLine } = meta
  if (reqEpoch != null && reqEpoch !== epoch) return 'reset'
  if (fromLine > 0 && fromLine < base) return 'reset'
  if (fromLine > maxLine + 1) return 'reset'
  return 'ok'
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
  EPOCH,
  getState,
  peekState,
  broadcast,
  loadLogFile,
  registerSSEClient,
  unregisterSSEClient,
  deleteState,
  discardPocketLog,
  ensurePocketLog,
  classifyCursor,
  getLineBase,
  logFile,
}
