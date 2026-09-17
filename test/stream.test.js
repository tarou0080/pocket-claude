const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { broadcast, emitLive, noteUuid, loadLogFile, logFile, classifyCursor, getState } = require('../services/stream')
const { CLAUDE_PROJECTS_DIR } = require('../services/history')

// v2.15.0 のテスト。services/stream.js は LOGS_DIR のパス注入に対応していない
// （tmpdir override が無い）ため、実際の config.LOGS_DIR にテスト専用のユニークIDで
// ファイルを作り、afterEachで必ず削除する。
//
// 注意: broadcast/emitLive/noteUuid は getState のメモリ内 state（lastUuid/bLines/turning）
// を使う。テストごとにユニークIDを使うため state の相互汚染は無い。

function testSessionId(name) {
  return `test-stream-${name}-${process.pid}-${Date.now()}`
}

let usedIds = []

test.afterEach(() => {
  for (const id of usedIds) {
    try { fs.unlinkSync(logFile(id)) } catch {}
    try { fs.unlinkSync(path.join(CLAUDE_PROJECTS_DIR, `${id}.jsonl`)) } catch {}
  }
  usedIds = []
})

// SSEクライアント（res）のスタブ。write を記録するだけ。
function stubRes() {
  const writes = []
  return {
    writes,
    write(s) { writes.push(s) },
  }
}

// classifyCursor() はクライアントのカーソル {fromA, fromB} がサーバーの現在状態
// {maxA, maxB} に対して有効か判定する純関数（v2.15.0）。from=0は「何も持っていない、
// 全部くれ」＝常にok。from > max+1（未来の行番号）ならreset。

test('classifyCursor: fromAがmaxA+1を超えればreset（未来の行番号）', () => {
  assert.equal(classifyCursor({ fromA: 12, fromB: 0 }, { maxA: 10, maxB: 10 }), 'reset')
})

test('classifyCursor: fromBがmaxB+1を超えればreset（未来の行番号）', () => {
  assert.equal(classifyCursor({ fromA: 0, fromB: 12 }, { maxA: 10, maxB: 10 }), 'reset')
})

test('classifyCursor: from=0は常にok（max=-1＝ファイル無しでも）', () => {
  assert.equal(classifyCursor({ fromA: 0, fromB: 0 }, { maxA: -1, maxB: -1 }), 'ok')
})

test('classifyCursor: 範囲内ならok（境界max+1を含む）', () => {
  assert.equal(classifyCursor({ fromA: 11, fromB: 5 }, { maxA: 10, maxB: 10 }), 'ok')
})

// broadcast() は after（直前のA行uuid）を付けてBへ書き、id: B<n> でSSEへ送る。

test('broadcastはafterを付けてBに書き、id:B<n>をSSEに送る', () => {
  const id = testSessionId('broadcast-1')
  usedIds.push(id)

  // A本体jsonl: 3行、最後のassistant行のuuidがafterになる
  const uuidA0 = '11111111-1111-1111-1111-111111111111'
  const uuidA1 = '22222222-2222-2222-2222-222222222222'
  const uuidA2 = '33333333-3333-3333-3333-333333333333'
  fs.writeFileSync(path.join(CLAUDE_PROJECTS_DIR, `${id}.jsonl`), [
    JSON.stringify({ type: 'user', uuid: uuidA0 }),
    JSON.stringify({ type: 'assistant', uuid: uuidA1 }),
    JSON.stringify({ type: 'assistant', uuid: uuidA2 }),
    '',
  ].join('\n'))

  const res = stubRes()
  const s = getState(id)
  s.sseClients.push(res)

  broadcast(id, { type: 'start' })

  const events = loadLogFile(id)
  assert.equal(events.length, 1)
  assert.equal(events[0].type, 'start')
  assert.equal(events[0].after, uuidA2)

  assert.equal(res.writes.length, 1)
  assert.ok(res.writes[0].startsWith('id: B0\n'))
  const sent = JSON.parse(res.writes[0].split('\ndata: ')[1].split('\n')[0])
  assert.equal(sent.type, 'start')
  assert.equal(sent.after, uuidA2)
})

test('broadcastはA無しでafter=null、2行目以降はメモリ内で採番される', () => {
  const id = testSessionId('broadcast-2')
  usedIds.push(id)

  const res = stubRes()
  const s = getState(id)
  s.sseClients.push(res)

  broadcast(id, { type: 'start' })
  broadcast(id, { type: 'system', subtype: 'init' })

  const events = loadLogFile(id)
  assert.equal(events.length, 2)
  assert.equal(events[0].after, null)
  assert.equal(events[1].after, null)
  assert.ok(res.writes[0].startsWith('id: B0\n'))
  assert.ok(res.writes[1].startsWith('id: B1\n'))
})

// emitLive() は B に書かず、buffer に積んで id 無しで配信する。

test('emitLiveはBに書かずbufferに積み、空idで配信する', () => {
  const id = testSessionId('emitlive-1')
  usedIds.push(id)

  const res = stubRes()
  const s = getState(id)
  s.sseClients.push(res)

  emitLive(id, { type: 'stream_event', event: { type: 'content_block_delta' } })

  assert.equal(loadLogFile(id).length, 0)
  assert.equal(s.buffer.length, 1)
  assert.equal(s.buffer[0].type, 'stream_event')
  assert.equal(res.writes.length, 1)
  assert.ok(res.writes[0].startsWith('id:\ndata:'))  // 空idで lastEventId を '' に戻す
  assert.ok(res.writes[0].startsWith('data: '))
})

// noteUuid() は次の broadcast の after を更新する。

test('noteUuidは次のbroadcastのafterに反映される', () => {
  const id = testSessionId('noteuuid-1')
  usedIds.push(id)

  const uuid = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  noteUuid(id, uuid)
  broadcast(id, { type: 'result' })

  const events = loadLogFile(id)
  assert.equal(events.length, 1)
  assert.equal(events[0].after, uuid)
})

test('broadcast後のnoteUuid→broadcastでafterが直前のA行に追従する', () => {
  const id = testSessionId('noteuuid-2')
  usedIds.push(id)

  const uuid1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  const uuid2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  noteUuid(id, uuid1)
  broadcast(id, { type: 'system', subtype: 'init' })
  noteUuid(id, uuid2)
  broadcast(id, { type: 'result' })

  const events = loadLogFile(id)
  assert.equal(events[0].after, uuid1)
  assert.equal(events[1].after, uuid2)
})

test('noteUuidはuuid無しで呼んでも直前の値を壊さない', () => {
  const id = testSessionId('noteuuid-3')
  usedIds.push(id)

  const uuid = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  noteUuid(id, uuid)
  noteUuid(id, '')
  broadcast(id, { type: 'done' })

  const events = loadLogFile(id)
  assert.equal(events[0].after, uuid)
})
