const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const { saveToolsCatalog, loadToolsCatalog, CATALOG_FILE } = require('../services/tools-catalog')

// tools-catalog.json は system/init イベントから学習したツール名一覧を保存する場所。
// 保存→読み出しで同じ配列が返ることだけを確認する（gitignore対象・本番環境を汚さないよう
// テスト後に必ず削除する）。

test.after(() => {
  try { fs.unlinkSync(CATALOG_FILE) } catch {}
})

test('保存したツール一覧を読み出せる', () => {
  const tools = ['Bash', 'Edit', 'Read', 'Write', 'WebFetch']
  assert.equal(saveToolsCatalog(tools), true)
  assert.deepEqual(loadToolsCatalog(), tools)
})

test('配列でない値は保存されない', () => {
  assert.equal(saveToolsCatalog('not-an-array'), false)
})

test('未保存(ファイル無し)時は空配列を返す', () => {
  try { fs.unlinkSync(CATALOG_FILE) } catch {}
  assert.deepEqual(loadToolsCatalog(), [])
})
