const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const config = require('../config/index')
const { sweepOldPocketLogs } = require('../services/directories')

// sweepOldPocketLogs（v2.12.3）: logs/*.jsonl のうち mtime が maxAgeDays 日より古いものだけ
// 削除する日数GC。services/directories.js は LOGS_DIR のパス注入に対応していない
// （test/migrate.test.jsのような tmpdir override が無い）ため、実際の config.LOGS_DIR に
// テスト専用のユニークIDでファイルを作り、afterEach で必ず削除する
// （test/stream.test.js の手法に倣う）。

function testFileName(name) {
  return `test-directories-${name}-${process.pid}-${Date.now()}.jsonl`
}

let usedFiles = []

test.afterEach(() => {
  for (const name of usedFiles) {
    try { fs.unlinkSync(path.join(config.LOGS_DIR, name)) } catch {}
  }
  usedFiles = []
})

test('sweepOldPocketLogs: 31日前のmtimeのjsonlは削除される', () => {
  const name = testFileName('old')
  usedFiles.push(name)
  const filePath = path.join(config.LOGS_DIR, name)
  fs.writeFileSync(filePath, '{"type":"log_start"}\n')
  const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000)
  fs.utimesSync(filePath, old, old)

  sweepOldPocketLogs(30)

  assert.equal(fs.existsSync(filePath), false)
})

test('sweepOldPocketLogs: 新しいjsonlは残る', () => {
  const name = testFileName('new')
  usedFiles.push(name)
  const filePath = path.join(config.LOGS_DIR, name)
  fs.writeFileSync(filePath, '{"type":"log_start"}\n')

  sweepOldPocketLogs(30)

  assert.equal(fs.existsSync(filePath), true)
})

test('sweepOldPocketLogs: .jsonl以外のファイルは古くても触らない', () => {
  const name = `test-directories-notjsonl-${process.pid}-${Date.now()}.log`
  const filePath = path.join(config.LOGS_DIR, name)
  fs.writeFileSync(filePath, 'not a pocket log\n')
  const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000)
  fs.utimesSync(filePath, old, old)

  try {
    sweepOldPocketLogs(30)
    assert.equal(fs.existsSync(filePath), true)
  } finally {
    try { fs.unlinkSync(filePath) } catch {}
  }
})
