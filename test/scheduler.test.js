const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { computeFireAt, schedules, STAGGER_MS, RESUME_BUFFER_MS, loadSchedules } = require('../services/scheduler')

// computeFireAt() は「他の実際に再開する(prompt有り)エントリの fireAt と STAGGER_MS 未満で
// 被らない発火時刻」を返す純粋な探索ロジック。schedules Map を直接操作して検証する
// （実タイマーは張らない＝scheduleResume() を経由しないので副作用ゼロ）。

test.afterEach(() => {
  schedules.forEach(s => clearTimeout(s.timerId))
  schedules.clear()
})

test('スケジュールが空なら基準時刻をそのまま返す', () => {
  const base = Date.now() + 100000
  assert.equal(computeFireAt(base, 'session-a'), base)
})

test('他セッションのfireAtとSTAGGER_MS未満で衝突する場合はSTAGGER_MSずつ後ろへずらす', () => {
  const base = Date.now() + 100000
  schedules.set('session-existing', { prompt: 'hello', fireAt: base })
  const result = computeFireAt(base, 'session-new')
  assert.equal(result, base + STAGGER_MS)
})

test('衝突が連鎖する場合は空いているスロットまでずらし続ける', () => {
  const base = Date.now() + 100000
  schedules.set('session-a', { prompt: 'hello', fireAt: base })
  schedules.set('session-b', { prompt: 'hello', fireAt: base + STAGGER_MS })
  const result = computeFireAt(base, 'session-c')
  assert.equal(result, base + STAGGER_MS * 2)
})

test('excludeSessionId で指定した自分自身のエントリとは衝突判定しない', () => {
  const base = Date.now() + 100000
  schedules.set('session-a', { prompt: 'hello', fireAt: base })
  // session-a 自身を再計算する場合、自分の既存エントリとは衝突しない
  const result = computeFireAt(base, 'session-a')
  assert.equal(result, base)
})

test('prompt無し(状態記録のみ)のエントリはずらし対象の衝突判定に含めない', () => {
  const base = Date.now() + 100000
  schedules.set('session-existing', { prompt: null, fireAt: base })
  const result = computeFireAt(base, 'session-new')
  assert.equal(result, base)
})

// loadSchedules() は一時ファイルで検証する（保存先も読み込み元に揃うので本番 schedules.json は触らない）。
// 張られたタイマーは afterEach で止める（発火は最短でも RESUME_BUFFER_MS 後）。
function writeTmpSchedules(data) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-sched-'))
  const file = path.join(dir, 'schedules.json')
  fs.writeFileSync(file, JSON.stringify(data))
  return file
}

test('再起動時、リセット時刻を過ぎた再開予約も捨てずに起動のバッファ後へ発火させる', () => {
  const past = new Date(Date.now() - 9000).toISOString()
  const file = writeTmpSchedules({ 'session-a': { resetAt: past, prompt: '続けて', project: 'home' } })
  const before = Date.now()
  loadSchedules(file)
  const s = schedules.get('session-a')
  assert.ok(s, '再開予約が残っていること')
  assert.ok(s.fireAt >= before + RESUME_BUFFER_MS)
})

test('再起動時、リセット時刻を過ぎた状態記録のみの予約は破棄しファイルからも消す', () => {
  const past = new Date(Date.now() - 9000).toISOString()
  const future = new Date(Date.now() + 3600000).toISOString()
  const file = writeTmpSchedules({
    'session-a': { resetAt: past, prompt: null },
    'session-b': { resetAt: future, prompt: null }
  })
  loadSchedules(file)
  assert.equal(schedules.has('session-a'), false)
  assert.equal(schedules.has('session-b'), true)
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8'))), ['session-b'])
})
