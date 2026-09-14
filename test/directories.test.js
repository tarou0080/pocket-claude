const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { sweepOldFiles } = require('../services/directories')

// sweepOldFiles（v2.12.3の単一用途関数をv2.13.0で汎用化）: dir配下のext拡張子ファイルの
// うちmtimeがmaxAgeDays日より古いものだけ削除する日数GC。dirはテストごとにmkdtempSyncで作る
// 一時ディレクトリを渡す（本番config.LOGS_DIR/SESSIONS_DIRには触れない）。

let tmpDir

test.beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-logs-'))
})

test.afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

test('sweepOldFiles: 31日前のmtimeのjsonlは削除される', () => {
  const filePath = path.join(tmpDir, 'old.jsonl')
  fs.writeFileSync(filePath, '{"type":"log_start"}\n')
  const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000)
  fs.utimesSync(filePath, old, old)

  sweepOldFiles(tmpDir, '.jsonl', 30)

  assert.equal(fs.existsSync(filePath), false)
})

test('sweepOldFiles: 新しいjsonlは残る', () => {
  const filePath = path.join(tmpDir, 'new.jsonl')
  fs.writeFileSync(filePath, '{"type":"log_start"}\n')

  sweepOldFiles(tmpDir, '.jsonl', 30)

  assert.equal(fs.existsSync(filePath), true)
})

test('sweepOldFiles: 対象拡張子以外のファイルは古くても触らない', () => {
  const filePath = path.join(tmpDir, 'notjsonl.log')
  fs.writeFileSync(filePath, 'not a pocket log\n')
  const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000)
  fs.utimesSync(filePath, old, old)

  sweepOldFiles(tmpDir, '.jsonl', 30)

  assert.equal(fs.existsSync(filePath), true)
})

test('sweepOldFiles: excludeのファイルは古くても残る', () => {
  const filePath = path.join(tmpDir, '.schema.json')
  fs.writeFileSync(filePath, '{"version":1}\n')
  const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000)
  fs.utimesSync(filePath, old, old)

  sweepOldFiles(tmpDir, '.json', 30, { exclude: ['.schema.json'] })

  assert.equal(fs.existsSync(filePath), true)
})
