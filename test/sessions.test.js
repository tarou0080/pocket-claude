const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { randomUUID } = require('crypto')
const { getSessionSettings, saveSessionSettings } = require('../services/sessions')

// services/sessions.js の sessionsDir は実行ディレクトリ固定（../sessions）で、
// テストのために本体を書き換えないため、実ディレクトリへ実際に書き込んで検証する。
// 稼働中サービスの既存セッションと衝突しないよう、必ず randomUUID() の新規IDを使い、
// テスト後に自分が作ったファイルだけを削除する。
const sessionsDir = path.join(__dirname, '..', 'sessions')

function cleanup(sessionId) {
  try { fs.unlinkSync(path.join(sessionsDir, `${sessionId}.json`)) } catch {}
}

// 予約投稿・自動再開が「レコード → セッション保存値 → 既定」の順で設定解決する際、
// 「セッション保存値」層を担うのが getSessionSettings/saveSessionSettings。
// 7/25の回帰は、この層が値を返せない/取り違えることで予約投稿が100%失敗した。

test('存在しないセッションはエラーにせずすべてnullで返す', () => {
  const sessionId = randomUUID()
  const settings = getSessionSettings(sessionId)
  assert.deepEqual(settings, { project: null, model: null, effort: null, thinking: null })
})

test('保存した値をそのまま取得できる（レコードとして正しく積める）', (t) => {
  const sessionId = randomUUID()
  t.after(() => cleanup(sessionId))

  saveSessionSettings(sessionId, { project: 'home', model: 'opus', effort: 'high', thinking: true })
  const settings = getSessionSettings(sessionId)
  assert.deepEqual(settings, { project: 'home', model: 'opus', effort: 'high', thinking: true })
})

test('部分更新は既存フィールドを壊さない（project保存後にmodelだけ更新してもprojectは残る）', (t) => {
  const sessionId = randomUUID()
  t.after(() => cleanup(sessionId))

  saveSessionSettings(sessionId, { project: 'home' })
  saveSessionSettings(sessionId, { model: 'sonnet' })
  const settings = getSessionSettings(sessionId)
  assert.equal(settings.project, 'home')
  assert.equal(settings.model, 'sonnet')
})

test('未指定フィールドは保存されず既定(null)のまま', (t) => {
  const sessionId = randomUUID()
  t.after(() => cleanup(sessionId))

  saveSessionSettings(sessionId, { project: 'home' })
  const settings = getSessionSettings(sessionId)
  assert.equal(settings.effort, null)
  assert.equal(settings.thinking, null)
})
