const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { broadcast, getLineBase, loadLogFile, logFile, classifyCursor, ensurePocketLog, EPOCH } = require('../services/stream')
const { CLAUDE_PROJECTS_DIR } = require('../services/history')

// getLineBaseは「今のファイルの行0が、セッション全体の行番号空間で何行目に当たるか」を
// 返し、routes/stream.js が各行の絶対idを base+i で計算するために使う（v2.12.3時点：
// pocketログは30日GCのみで破棄されないため base は常に0になるが、行番号空間の定義として
// 維持している。services/stream.js の getLineBase コメント参照）。
//
// v2.12.2: broadcast()冒頭のensurePocketLog安全網により、ファイルが存在しない状態での
// 最初のbroadcastは必ず log_start 行を1本消費してから本来のイベントを書く（このテスト用
// セッションIDには本体jsonlが存在しないため mainLines=0 の log_start になる）。以下の行数・
// id期待値はその log_start 分を織り込んでいる。
//
// services/stream.js は LOGS_DIR のパス注入に対応していない（test/migrate.test.jsのような
// tmpdir override が無い）ため、実際の config.LOGS_DIR にテスト専用のユニークIDでファイルを
// 作り、afterEachで必ず削除する。

function testSessionId(name) {
  return `test-stream-${name}-${process.pid}-${Date.now()}`
}

let usedIds = []

test.afterEach(() => {
  for (const id of usedIds) {
    try { fs.unlinkSync(logFile(id)) } catch {}
  }
  usedIds = []
})

test('getLineBaseは未初期化セッションをファイル長で初期化しbase=0を返す', () => {
  const id = testSessionId('b')
  usedIds.push(id)
  const base = getLineBase(id, 0)
  assert.equal(base, 0)
})

// classifyCursor() はクライアントのカーソル {epoch, fromLine} がサーバーの現在状態
// {epoch, base, maxLine} に対して有効か判定する純関数（v2.12.2、Kafka OffsetOutOfRange＋
// epoch相当）。fromLine=0は「何も持っていない、全部くれ」＝常にok。それ以外は
// epoch不一致／fromLine<base（有限化で消えた行）／fromLine>maxLine+1（未来の行番号）の
// いずれかでreset。

test('classifyCursor: epochが現在と不一致ならreset', () => {
  const status = classifyCursor({ epoch: 111, fromLine: 5 }, { epoch: 222, base: 0, maxLine: 10 })
  assert.equal(status, 'reset')
})

test('classifyCursor: fromLineがbaseより小さければreset（有限化で失われた行）', () => {
  const status = classifyCursor({ epoch: 222, fromLine: 3 }, { epoch: 222, base: 5, maxLine: 10 })
  assert.equal(status, 'reset')
})

test('classifyCursor: fromLineがmaxLine+1を超えればreset（未来の行番号）', () => {
  const status = classifyCursor({ epoch: 222, fromLine: 12 }, { epoch: 222, base: 0, maxLine: 10 })
  assert.equal(status, 'reset')
})

test('classifyCursor: fromLine=0は常にok（epoch不一致でもreset扱いにしない）', () => {
  const status = classifyCursor({ epoch: 111, fromLine: 0 }, { epoch: 222, base: 5, maxLine: 10 })
  assert.equal(status, 'ok')
})

test('classifyCursor: epoch一致・範囲内ならok', () => {
  const status = classifyCursor({ epoch: 222, fromLine: 7 }, { epoch: 222, base: 5, maxLine: 10 })
  assert.equal(status, 'ok')
})

test('classifyCursor: epoch未指定（Last-Event-ID経路）ならepoch不一致は判定しない', () => {
  const status = classifyCursor({ epoch: undefined, fromLine: 7 }, { epoch: 222, base: 5, maxLine: 10 })
  assert.equal(status, 'ok')
})

// ensurePocketLog() はpocketログファイルが無ければ log_start 行を書く（v2.12.2）。
// mainLines は本体jsonl（CLAUDE_PROJECTS_DIR側）の非空行数。getSessionEvents（services/history.js）
// がこの値で本体jsonlをsliceし、続きはSSEのpocketログ再生に委ねる境界情報になる。

let usedMainIds = []
test.afterEach(() => {
  for (const id of usedMainIds) {
    try { fs.unlinkSync(path.join(CLAUDE_PROJECTS_DIR, `${id}.jsonl`)) } catch {}
  }
  usedMainIds = []
})

test('ensurePocketLogはファイルが無ければ本体jsonlの非空行数をmainLinesとするlog_start行を書く', () => {
  const id = testSessionId('logstart-1')
  usedIds.push(id)
  usedMainIds.push(id)
  fs.writeFileSync(path.join(CLAUDE_PROJECTS_DIR, `${id}.jsonl`), '{"a":1}\n{"a":2}\n\n')

  ensurePocketLog(id)
  const events = loadLogFile(id)
  assert.equal(events.length, 1)
  assert.equal(events[0].type, 'log_start')
  assert.equal(events[0].mainLines, 2)
  assert.equal(events[0].epoch, EPOCH)
})

test('ensurePocketLogは本体jsonlが無ければmainLines=0で書く', () => {
  const id = testSessionId('logstart-2')
  usedIds.push(id)

  ensurePocketLog(id)
  const events = loadLogFile(id)
  assert.equal(events.length, 1)
  assert.equal(events[0].type, 'log_start')
  assert.equal(events[0].mainLines, 0)
})

test('ensurePocketLogは既にファイルがあれば何もしない（冪等）', () => {
  const id = testSessionId('logstart-3')
  usedIds.push(id)

  ensurePocketLog(id)
  assert.equal(loadLogFile(id).length, 1)
  ensurePocketLog(id)
  assert.equal(loadLogFile(id).length, 1)  // 2回目は追記されない
})
