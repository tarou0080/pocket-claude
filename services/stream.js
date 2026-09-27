const fs = require('fs')
const path = require('path')
const config = require('../config/index')
const { findTranscript } = require('./claude-dir')

// 1セッションあたりのメモリ内バッファ上限。常駐プロセス＋長時間セッションで
// buffer が単調増加しメモリを食い潰すのを防ぐ。超過分は古いものから捨てる。
// v2.15.0: buffer（M）は「現在ターンの stdout 生イベント」だけを持つ。永続化しない
// （完全な履歴は A＝本体jsonl と B＝pocketログ が担う）。
const MAX_BUFFER = 5000

// sessionIDごとの実行状態（メモリ）
const state = {}

// 状態の覗き見（getState と違い、無ければ作らない）。
// 「このセッションは今動いているか」を候補分だけ問い合わせる用途で、
// 存在しないIDのぶんまで state を生やさないために分けている。
function peekState(sessionId) {
  return state[sessionId] || null
}

// ターン実行中のセッションID一覧。サービス再起動は実行中のターンを捨てるので、
// 外部の保守作業（CLI自動更新）が「今再起動してよいか」を判断する材料にする。
function turningSessions() {
  return Object.keys(state).filter(id => state[id].turning)
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
      pendingModel: null,
      // 直前のA行の uuid（broadcast が after を付けるための材料）。
      // undefined＝未初期化（spawn直後等）。broadcast 時にAから初期化する。
      lastUuid: undefined,
      // B（pocketログ）の追記済み非空行数。未初期化なら broadcast 時にファイルから数える。
      bLines: undefined
    }
  }
  return state[sessionId]
}

// ログファイルパス
function logFile(sessionId) {
  return path.join(config.LOGS_DIR, `${sessionId}.jsonl`)
}

// A（本体jsonl）の非空行をパースし、最後の user/assistant 行の uuid を返す。
// A 無し・該当行無しは null。
function lastAUuid(sessionId) {
  let raw
  try {
    const p = findTranscript(sessionId)
    if (!p) return null
    raw = fs.readFileSync(p, 'utf8')
  } catch {
    return null
  }
  let uuid = null
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let entry
    try { entry = JSON.parse(line) } catch { continue }
    if (entry && (entry.type === 'user' || entry.type === 'assistant') && entry.uuid != null) {
      uuid = entry.uuid
    }
  }
  return uuid
}

// 全クライアントに配信（事実のみ。Bへ appendFileSync し、id: B<n> で送る）。
// v2.15.0: Bの各行は after: <uuid|null>（＝直前のA行のuuid）を自ら持つ。s.lastUuid が
// 未初期化（spawn直後・サーバー再起動直後）ならAから初期化する。
function broadcast(sessionId, event) {
  const s = getState(sessionId)
  if (event.type === 'result' || event.type === 'done' || event.type === 'error') s.turning = false
  if (s.lastUuid === undefined) s.lastUuid = lastAUuid(sessionId)
  const ev = Object.assign({}, event, { after: s.lastUuid === undefined ? null : s.lastUuid })
  // 行番号 b ＝追記前のB非空行数。セッションごとにメモリで数え、未初期化ならファイルから。
  if (s.bLines === undefined) s.bLines = loadLogFile(sessionId).length
  const b = s.bLines
  // appendFileSync で同期化することで、history 読み出し（readFileSync）時に
  // 必ず最新行まで反映されている状態を保証する（read-then-subscribe の取りこぼし/重複排除）
  fs.appendFileSync(logFile(sessionId), JSON.stringify(ev) + '\n')
  s.bLines++
  const line = `id: B${b}\ndata: ${JSON.stringify(ev)}\n\n`
  s.sseClients.forEach(res => {
    try {
      res.write(line)
    } catch {}
  })
}

// 現在ターンの stdout 生イベントを配信（v2.15.0）。
// M（s.buffer）へ push（上限 MAX_BUFFER・古い方を捨てる）し、id 無しの data: 行で
// 全 SSE クライアントへ送る。Bには書かない（完全な履歴はAが担う）。
function emitLive(sessionId, event) {
  const s = getState(sessionId)
  s.buffer.push(event)
  if (s.buffer.length > MAX_BUFFER) s.buffer.splice(0, s.buffer.length - MAX_BUFFER)
  // 空の `id:` で lastEventId を '' に戻す（id 付きイベントとの区別。routes/stream.js sendEvent と同じ）
  const line = `id:\ndata: ${JSON.stringify(event)}\n\n`
  s.sseClients.forEach(res => {
    try {
      res.write(line)
    } catch {}
  })
}

// 直前のA行 uuid の追跡更新（v2.15.0）。spawner.js が stdout の assistant/user イベントを
// 受けたときに呼ぶ。次の broadcast の after はこの値になる。uuid が空文字列なら
// 「uuidを持たないイベント」なので更新しない（直前のA行を失わない）。
function noteUuid(sessionId, uuid) {
  if (uuid === '') return
  const s = getState(sessionId)
  s.lastUuid = uuid
}

// ログファイルからイベント配列を復元
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

// カーソル（クライアントが送ってきた {fromA, fromB}）がサーバーの現在状態
// {maxA, maxB} に対して有効か判定する純関数（v2.15.0）。
//  - from=0 は「何も持っていない、全部くれ」＝常に ok
//  - from > max+1 → reset（未来の行番号＝サーバーの行数を追い越している）
//  - それ以外は ok（from <= max+1 ならその位置からの続きが取れる）
function classifyCursor(cursor, meta) {
  const { fromA, fromB } = cursor
  const { maxA, maxB } = meta
  if (fromA > maxA + 1) return 'reset'
  if (fromB > maxB + 1) return 'reset'
  return 'ok'
}

module.exports = {
  getState,
  peekState,
  turningSessions,
  broadcast,
  emitLive,
  noteUuid,
  loadLogFile,
  registerSSEClient,
  unregisterSSEClient,
  deleteState,
  classifyCursor,
  logFile,
}
