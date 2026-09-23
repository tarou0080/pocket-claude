const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { randomUUID } = require('crypto')

// CLI は cwd ごとに別ディレクトリへ会話jsonlを書く。履歴一覧・会話の読み込み・事実の読み取りが
// どのプロジェクトの会話でも見つけられることを確かめる。本番の ~/.claude と config.json には
// 触れない（CLAUDE_CONFIG_DIR を一時ディレクトリへ向け、config.projects を注入する）。

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-project-dirs-'))
process.env.CLAUDE_CONFIG_DIR = path.join(tmpRoot, 'claude')
for (const m of ['../services/claude-dir', '../services/history', '../services/session-facts']) {
  delete require.cache[require.resolve(m)]
}
const config = require('../config/index')
const { projectDirFor, projectDirs, findTranscript } = require('../services/claude-dir')
const { listSessions, getSessionMessages } = require('../services/history')
const { readSessionFacts, projectFromCwd } = require('../services/session-facts')

const homeCwd = path.join(tmpRoot, 'home.user')
const reportsCwd = path.join(tmpRoot, 'sys$', 'reports_x')

test.before(() => {
  test.prevProjects = config.projects
  config.projects = { home: homeCwd, reports: reportsCwd }
})
test.after(() => {
  config.projects = test.prevProjects
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

function writeTranscript(cwd, id, text) {
  const dir = projectDirFor(cwd)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${id}.jsonl`), [
    { type: 'user', cwd, message: { content: text } },
    { type: 'assistant', message: { model: 'claude-test', content: [{ type: 'text', text: 'ok' }] } },
  ].map(l => JSON.stringify(l)).join('\n') + '\n')
}

test('projectDirFor: 英数字以外は全部 "-"（CLI と同じ規則。"." "_" "$" も置換）', () => {
  const name = path.basename(projectDirFor('/mnt/caitin_karin-fs/sys$/reports'))
  assert.equal(name, '-mnt-caitin-karin-fs-sys--reports')
  assert.equal(path.basename(projectDirFor('/home/john.doe')), '-home-john-doe')
})

test('projectDirFor: 200文字超は CLI が付けたハッシュ付きの実在ディレクトリを接頭辞で見つける', () => {
  const longCwd = '/' + 'a'.repeat(250)
  const prefix = ('-' + 'a'.repeat(250)).slice(0, 200) + '-'
  const real = path.join(process.env.CLAUDE_CONFIG_DIR, 'projects', prefix + 'xyz123')
  fs.mkdirSync(real, { recursive: true })
  assert.equal(projectDirFor(longCwd), real)
})

test('projectDirs: 登録済みプロジェクトごとの置き場', () => {
  assert.deepEqual(projectDirs(), [projectDirFor(homeCwd), projectDirFor(reportsCwd)])
})

test('listSessions: project 指定でそのプロジェクトの会話だけ・省略で全部', () => {
  const h = randomUUID(), r = randomUUID()
  writeTranscript(homeCwd, h, 'home の会話')
  writeTranscript(reportsCwd, r, 'reports の会話')

  const onlyReports = listSessions('reports')
  assert.deepEqual(onlyReports.map(s => s.sessionId), [r])
  assert.equal(onlyReports[0].project, 'reports')
  assert.equal(onlyReports[0].title, 'reports の会話')

  assert.deepEqual(listSessions('home').map(s => s.sessionId), [h])
  assert.deepEqual(new Set(listSessions().map(s => s.sessionId)), new Set([h, r]))
  assert.deepEqual(listSessions('unknown'), [])
})

test('findTranscript / getSessionMessages / readSessionFacts: 別プロジェクトの会話も読める', () => {
  const r = randomUUID()
  writeTranscript(reportsCwd, r, 'reports で質問')

  assert.equal(findTranscript(r), path.join(projectDirFor(reportsCwd), `${r}.jsonl`))
  assert.equal(findTranscript(randomUUID()), null)

  const msgs = getSessionMessages(r)
  assert.equal(msgs[0].text, 'reports で質問')

  const facts = readSessionFacts(r)
  assert.equal(facts.cwd, reportsCwd)
  assert.equal(projectFromCwd(facts.cwd, config.projects), 'reports')
})
