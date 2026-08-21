const test = require('node:test')
const assert = require('node:assert/strict')
const { computeFireAt, schedules, STAGGER_MS } = require('../services/scheduler')

// computeFireAt() は「他の実際に再開する(prompt有り)エントリの fireAt と STAGGER_MS 未満で
// 被らない発火時刻」を返す純粋な探索ロジック。schedules Map を直接操作して検証する
// （実タイマーは張らない＝scheduleResume() を経由しないので副作用ゼロ）。

test.afterEach(() => {
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
