const test = require('node:test')
const assert = require('node:assert/strict')
const { parseResetTime } = require('../services/reset-time')

// 2026-09-26 12:29 JST に週制限へ当たった実例。日付を読まずに「次の3時」とすると 9/27 03:00 と1日早くなっていた。
const NOW = new Date('2026-09-26T12:29:41+09:00')

test('週制限の日付付き文言は日付どおりに解釈する', () => {
  const d = parseResetTime("You've hit your weekly limit · resets Sep 28, 3am (Asia/Tokyo)", NOW)
  assert.equal(d.toISOString(), '2026-09-27T18:00:00.000Z')
})

test('時刻のみの文言は従来どおり次に来るその時刻（今日）', () => {
  const d = parseResetTime("You've hit your session limit · resets 11:30pm (Asia/Tokyo)", NOW)
  assert.equal(d.toISOString(), '2026-09-26T14:30:00.000Z')
})

test('時刻のみで今日のその時刻を過ぎていれば明日', () => {
  const d = parseResetTime('resets 11:50am (Asia/Tokyo)', NOW)
  assert.equal(d.toISOString(), '2026-09-27T02:50:00.000Z')
})

test('年末に出た翌年1月の日付は翌年として解釈する', () => {
  const d = parseResetTime('resets Jan 2, 3am (Asia/Tokyo)', new Date('2026-12-31T19:00:00+09:00'))
  assert.equal(d.toISOString(), '2027-01-01T18:00:00.000Z')
})

test('日付付きでもタイムゾーンを反映する', () => {
  const d = parseResetTime('resets Oct 5, 9pm (America/New_York)', NOW)
  assert.equal(d.toISOString(), '2026-10-06T01:00:00.000Z')
})
