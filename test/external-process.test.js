const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { findClaudePid } = require('../services/external-process')

function makeFakeProc(procDir, pid, argv0, args) {
  const pidDir = path.join(procDir, String(pid))
  fs.mkdirSync(pidDir, { recursive: true })
  const parts = [argv0, ...args]
  fs.writeFileSync(path.join(pidDir, 'cmdline'), parts.join('\0') + '\0')
}

test('findClaudePid: --session-id 一致で pid を返す', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-external-'))
  makeFakeProc(dir, 12345, '/usr/local/bin/claude', ['--session-id', 'sess-abc-123', '-p'])
  assert.equal(findClaudePid('sess-abc-123', dir), 12345)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('findClaudePid: --resume 一致でも pid を返す', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-external-'))
  makeFakeProc(dir, 23456, 'claude', ['--resume', 'sess-resume-456', '-p'])
  assert.equal(findClaudePid('sess-resume-456', dir), 23456)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('findClaudePid: basename が claude でないプロセスは無視', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-external-'))
  makeFakeProc(dir, 11111, '/usr/bin/docker', ['exec', 'claude', '--session-id', 'sess-abc-123'])
  assert.equal(findClaudePid('sess-abc-123', dir), null)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('findClaudePid: 該当なしは null', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-external-'))
  makeFakeProc(dir, 22222, 'claude', ['--session-id', 'other-id'])
  assert.equal(findClaudePid('sess-notfound-999', dir), null)
  fs.rmSync(dir, { recursive: true, force: true })
})
