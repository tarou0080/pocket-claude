const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { sweepOldPocketLogs } = require('../services/directories')

// sweepOldPocketLogs（v2.12.3）: logs/*.jsonl のうち mtime が maxAgeDays 日より古いものだけ
// 削除する日数GC。第2引数で対象ディレクトリを注入できる（v2.12.4）ため、本番 config.LOGS_DIR
// には触れず、テストごとに mkdtempSync で作る一時ディレクトリだけで検証する。

let tmpDir

test.beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-logs-'))
})

test.afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

test('sweepOldPocketLogs: 31日前のmtimeのjsonlは削除される', () => {
  const filePath = path.join(tmpDir, 'old.jsonl')
  fs.writeFileSync(filePath, '{"type":"log_start"}\n')
  const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000)
  fs.utimesSync(filePath, old, old)

  sweepOldPocketLogs(30, tmpDir)

  assert.equal(fs.existsSync(filePath), false)
})

test('sweepOldPocketLogs: 新しいjsonlは残る', () => {
  const filePath = path.join(tmpDir, 'new.jsonl')
  fs.writeFileSync(filePath, '{"type":"log_start"}\n')

  sweepOldPocketLogs(30, tmpDir)

  assert.equal(fs.existsSync(filePath), true)
})

test('sweepOldPocketLogs: .jsonl以外のファイルは古くても触らない', () => {
  const filePath = path.join(tmpDir, 'notjsonl.log')
  fs.writeFileSync(filePath, 'not a pocket log\n')
  const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000)
  fs.utimesSync(filePath, old, old)

  sweepOldPocketLogs(30, tmpDir)

  assert.equal(fs.existsSync(filePath), true)
})
