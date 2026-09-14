const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const { broadcast, discardPocketLog, getLineBase, loadLogFile, logFile } = require('../services/stream')

// getLineBase()/discardPocketLog() は v2.12.1 の行番号空間仕様を担う純関数寄りのペア:
// discardPocketLog はライブログファイルを消すだけで、行番号カウンタ（lineCounts）は
// 巻き戻さない。クライアントのdedupは「lineId <= 直近受信行なら捨てる」ため、破棄直後に
// 積み直すファイルの行0からidを0で振り直すと、次ターンのイベントが全部stale扱いで
// 捨てられてしまう（services/stream.js のコメント参照）。getLineBaseは「今のファイルの
// 行0が、セッション全体の行番号空間で何行目に当たるか」を返し、routes/stream.js が
// 各行の絶対idを base+i で計算するために使う。
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

test('discardPocketLogはファイルを消すがlineCountsは巻き戻さない', () => {
  const id = testSessionId('a')
  usedIds.push(id)
  broadcast(id, { type: 'user_input', text: 'hi' })
  broadcast(id, { type: 'result' })
  assert.equal(loadLogFile(id).length, 2)

  discardPocketLog(id)
  assert.equal(fs.existsSync(logFile(id)), false)

  // 破棄後の次ターン: ファイルは0件から積み直るが、絶対id空間は続きから始まるはず
  broadcast(id, { type: 'user_input', text: 'next turn' })
  const events = loadLogFile(id)
  assert.equal(events.length, 1)
  const base = getLineBase(id, events.length)
  assert.equal(base, 2)
})

test('getLineBaseは未初期化セッションをファイル長で初期化しbase=0を返す', () => {
  const id = testSessionId('b')
  usedIds.push(id)
  const base = getLineBase(id, 0)
  assert.equal(base, 0)
})

test('routes/stream.js相当: 破棄後の各行の絶対id(base+i)がlineCounts空間で連続する', () => {
  const id = testSessionId('c')
  usedIds.push(id)
  broadcast(id, { type: 'user_input', text: 't1' })
  broadcast(id, { type: 'result' })
  discardPocketLog(id)

  broadcast(id, { type: 'user_input', text: 't2' })
  broadcast(id, { type: 'stream_event', event: {} })

  const events = loadLogFile(id)
  const base = getLineBase(id, events.length)
  const ids = events.map((_, i) => base + i)
  assert.deepEqual(ids, [2, 3])
})
