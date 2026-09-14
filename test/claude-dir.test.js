const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { readCleanupPeriodDays } = require('../services/claude-dir')

// readCleanupPeriodDays: Claude Code の cleanupPeriodDays を managed-settings.json > user
// settings.json の順に読む。files引数([managedPath, userPath])でテストからパスを注入できる。
// 本番の /etc/claude-code/managed-settings.json・~/.claude/settings.json には触れない。

let tmpDir

test.beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-claude-dir-'))
})

test.afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj))
}

test('readCleanupPeriodDays: userのみ20 -> 20', () => {
  const managedPath = path.join(tmpDir, 'managed.json')
  const userPath = path.join(tmpDir, 'user.json')
  writeJson(userPath, { cleanupPeriodDays: 20 })

  assert.equal(readCleanupPeriodDays([managedPath, userPath]), 20)
})

test('readCleanupPeriodDays: managed=10・user=20 -> managedの10が勝つ', () => {
  const managedPath = path.join(tmpDir, 'managed.json')
  const userPath = path.join(tmpDir, 'user.json')
  writeJson(managedPath, { cleanupPeriodDays: 10 })
  writeJson(userPath, { cleanupPeriodDays: 20 })

  assert.equal(readCleanupPeriodDays([managedPath, userPath]), 10)
})

test('readCleanupPeriodDays: どちらも無し -> 既定30', () => {
  const managedPath = path.join(tmpDir, 'managed.json')
  const userPath = path.join(tmpDir, 'user.json')

  assert.equal(readCleanupPeriodDays([managedPath, userPath]), 30)
})

test('readCleanupPeriodDays: 0 -> 不正値扱いで既定30', () => {
  const managedPath = path.join(tmpDir, 'managed.json')
  const userPath = path.join(tmpDir, 'user.json')
  writeJson(userPath, { cleanupPeriodDays: 0 })

  assert.equal(readCleanupPeriodDays([managedPath, userPath]), 30)
})

test('readCleanupPeriodDays: 非数 -> 不正値扱いで既定30', () => {
  const managedPath = path.join(tmpDir, 'managed.json')
  const userPath = path.join(tmpDir, 'user.json')
  writeJson(userPath, { cleanupPeriodDays: 'abc' })

  assert.equal(readCleanupPeriodDays([managedPath, userPath]), 30)
})

test('CLAUDE_PROJECTS_DIR: CLAUDE_CONFIG_DIRに追従する', () => {
  const prevEnv = process.env.CLAUDE_CONFIG_DIR
  const fakeConfigDir = path.join(tmpDir, 'custom-claude-dir')
  process.env.CLAUDE_CONFIG_DIR = fakeConfigDir

  delete require.cache[require.resolve('../services/claude-dir')]
  const { CLAUDE_PROJECTS_DIR } = require('../services/claude-dir')

  assert.ok(CLAUDE_PROJECTS_DIR.startsWith(fakeConfigDir + path.sep))
  assert.ok(CLAUDE_PROJECTS_DIR.includes(path.join('projects')))

  if (prevEnv === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = prevEnv
  delete require.cache[require.resolve('../services/claude-dir')]
})
