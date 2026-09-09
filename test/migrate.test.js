const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { randomUUID } = require('crypto')
const { runStartupMigration, mergeFields } = require('../services/migrate')

// 起動時マイグレーション（v2.12.0）: pocket ID → Claude session ID 統一。
// 破壊的なので、実体の sessions/ logs/ ではなく tmpdir を paths override で渡して検証する。

function mkEnv() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-migrate-'))
  const P = {
    ROOT: root,
    SESSIONS_DIR: path.join(root, 'sessions'),
    LOGS_DIR: path.join(root, 'logs'),
    SCHEMA_FILE: path.join(root, 'sessions', '.schema.json'),
    SCHEDULES_FILE: path.join(root, 'schedules.json'),
    POSTS_FILE: path.join(root, 'scheduled-posts.json'),
    CLAUDE_PROJECTS_DIR: path.join(root, 'projects'),
  }
  fs.mkdirSync(P.SESSIONS_DIR, { recursive: true })
  fs.mkdirSync(P.LOGS_DIR, { recursive: true })
  fs.mkdirSync(P.CLAUDE_PROJECTS_DIR, { recursive: true })
  return { root, P }
}
const sess = (P, id, obj) => fs.writeFileSync(path.join(P.SESSIONS_DIR, `${id}.json`), JSON.stringify(obj))
const readSess = (P, id) => JSON.parse(fs.readFileSync(path.join(P.SESSIONS_DIR, `${id}.json`), 'utf8'))
const plog = (P, id, lines) => fs.writeFileSync(path.join(P.LOGS_DIR, `${id}.jsonl`), lines.map(JSON.stringify).join('\n') + '\n')
const mainjsonl = (P, id) => fs.writeFileSync(path.join(P.CLAUDE_PROJECTS_DIR, `${id}.jsonl`), '{"type":"user"}\n')
const exists = (dir, name) => fs.existsSync(path.join(dir, name))

test('mergeFields: 片側だけ明示ならその値、両方明示で相違ならpocket側', () => {
  const { merged, conflicts } = mergeFields(
    { model: 'sonnet', effort: 'high', project: 'home' },
    { model: 'opus', thinking: true })
  assert.equal(merged.model, 'sonnet')   // 両方明示・相違 → pocket
  assert.equal(merged.effort, 'high')    // pocketのみ
  assert.equal(merged.thinking, true)    // selfのみ
  assert.equal(merged.project, 'home')
  assert.deepEqual(conflicts.map(c => c.field), ['model'])
  assert.equal(conflicts[0].chosen, 'sonnet')
  assert.equal(conflicts[0].loser, 'opus')
})

test('mergeFields: claudeSessionId / movedTo は結果に残さない', () => {
  const { merged } = mergeFields({ claudeSessionId: 'x', project: 'home' }, { movedTo: 'y' })
  assert.equal(merged.claudeSessionId, undefined)
  assert.equal(merged.movedTo, undefined)
  assert.equal(merged.project, 'home')
})

test('分裂レコード: sessions/<claudeId>.json へ寄せ、旧IDは転送スタブ、logは削除', () => {
  const { root, P } = mkEnv()
  test.after?.(() => fs.rmSync(root, { recursive: true, force: true }))
  const pocketId = randomUUID(), claudeId = randomUUID()
  sess(P, pocketId, { claudeSessionId: claudeId, project: 'home', model: 'sonnet' })
  plog(P, pocketId, [{ type: 'start' }, { type: 'done' }])
  mainjsonl(P, claudeId)

  const r = runStartupMigration({ paths: P })
  assert.equal(r.applied, true)
  assert.equal(r.counts.split, 1)
  assert.deepEqual(readSess(P, pocketId), { movedTo: claudeId, schemaVersion: 1 })
  const canon = readSess(P, claudeId)
  assert.equal(canon.project, 'home')
  assert.equal(canon.model, 'sonnet')
  assert.equal(canon.claudeSessionId, undefined)
  assert.equal(exists(P.LOGS_DIR, `${pocketId}.jsonl`), false)
  fs.rmSync(root, { recursive: true, force: true })
})

test('自己レコード衝突(166相当): 既存 sessions/<claudeId>.json とフィールド衝突を pocket側で解決・記録', () => {
  const { root, P } = mkEnv()
  const pocketId = randomUUID(), claudeId = randomUUID()
  sess(P, pocketId, { claudeSessionId: claudeId, model: 'sonnet', effort: 'low' })
  sess(P, claudeId, { model: 'opus', project: 'home' })  // 既存の自己レコード
  mainjsonl(P, claudeId)

  const r = runStartupMigration({ paths: P })
  assert.equal(r.counts.selfRecordExists, 1)
  assert.equal(r.counts.recordsWithAnyConflict, 1)
  const canon = readSess(P, claudeId)
  assert.equal(canon.model, 'sonnet')  // 両方明示・相違 → pocket
  assert.equal(canon.effort, 'low')    // pocketのみ
  assert.equal(canon.project, 'home')  // selfのみ
  fs.rmSync(root, { recursive: true, force: true })
})

test('ログ両在(132相当): pocketログと本体jsonlが両方あっても pocketログは削除される', () => {
  const { root, P } = mkEnv()
  const pocketId = randomUUID(), claudeId = randomUUID()
  sess(P, pocketId, { claudeSessionId: claudeId })
  plog(P, pocketId, [{ type: 'user_input', text: 'hi' }])
  mainjsonl(P, claudeId)

  const r = runStartupMigration({ paths: P })
  assert.equal(r.counts.bothLogs, 1)
  assert.equal(exists(P.LOGS_DIR, `${pocketId}.jsonl`), false)
  fs.rmSync(root, { recursive: true, force: true })
})

test('抜け殻(orphan)ログ: 本体jsonlも分裂レコードも無いログは削除される（4b）', () => {
  const { root, P } = mkEnv()
  const orphan = randomUUID()
  plog(P, orphan, [{ type: 'start' }, { type: 'done' }])   // 本体jsonl無し

  const r = runStartupMigration({ paths: P })
  assert.equal(r.counts.split, 0)
  assert.equal(exists(P.LOGS_DIR, `${orphan}.jsonl`), false)
  fs.rmSync(root, { recursive: true, force: true })
})

test('冪等: 2回実行しても sessions/ の内容は変わらない（2回目は skip）', () => {
  const { root, P } = mkEnv()
  const pocketId = randomUUID(), claudeId = randomUUID()
  sess(P, pocketId, { claudeSessionId: claudeId, project: 'home' })
  mainjsonl(P, claudeId)

  const r1 = runStartupMigration({ paths: P })
  assert.equal(r1.applied, true)
  const after1 = {
    stub: readSess(P, pocketId),
    canon: readSess(P, claudeId),
    schema: JSON.parse(fs.readFileSync(P.SCHEMA_FILE, 'utf8')).version,
  }
  const r2 = runStartupMigration({ paths: P })
  assert.equal(r2.skipped, true)
  assert.deepEqual(readSess(P, pocketId), after1.stub)
  assert.deepEqual(readSess(P, claudeId), after1.canon)
  assert.equal(after1.schema, 1)
  fs.rmSync(root, { recursive: true, force: true })
})

test('schedules.json / scheduled-posts.json のキー・sessionId を正規IDへ貼り替える', () => {
  const { root, P } = mkEnv()
  const pocketId = randomUUID(), claudeId = randomUUID()
  sess(P, pocketId, { claudeSessionId: claudeId })
  mainjsonl(P, claudeId)
  fs.writeFileSync(P.SCHEDULES_FILE, JSON.stringify({ [pocketId]: { resetAt: 'x', prompt: null } }))
  fs.writeFileSync(P.POSTS_FILE, JSON.stringify({ p1: { id: 'p1', sessionId: pocketId, prompt: 'q' } }))

  runStartupMigration({ paths: P })
  const sch = JSON.parse(fs.readFileSync(P.SCHEDULES_FILE, 'utf8'))
  assert.equal(sch[pocketId], undefined)
  assert.ok(sch[claudeId])
  const posts = JSON.parse(fs.readFileSync(P.POSTS_FILE, 'utf8'))
  assert.equal(posts.p1.sessionId, claudeId)
  fs.rmSync(root, { recursive: true, force: true })
})

test('dryRun: 何も書かず件数を返す', () => {
  const { root, P } = mkEnv()
  const pocketId = randomUUID(), claudeId = randomUUID()
  sess(P, pocketId, { claudeSessionId: claudeId })
  sess(P, claudeId, { model: 'opus' })
  plog(P, pocketId, [{ type: 'user_input' }])
  mainjsonl(P, claudeId)

  const r = runStartupMigration({ paths: P, dryRun: true })
  assert.equal(r.dryRun, true)
  assert.equal(r.counts.split, 1)
  assert.equal(r.counts.selfRecordExists, 1)
  assert.equal(r.counts.bothLogs, 1)
  // 書き込みが起きていない
  assert.equal(fs.existsSync(P.SCHEMA_FILE), false)
  assert.deepEqual(readSess(P, pocketId), { claudeSessionId: claudeId })
  assert.equal(exists(P.LOGS_DIR, `${pocketId}.jsonl`), true)
  fs.rmSync(root, { recursive: true, force: true })
})

test('非分裂の自己レコード（claudeSessionId無し）はマイグレーション対象外', () => {
  const { root, P } = mkEnv()
  const id = randomUUID()
  sess(P, id, { project: 'home', started: true })
  mainjsonl(P, id)
  const r = runStartupMigration({ paths: P })
  assert.equal(r.counts.split, 0)
  assert.deepEqual(readSess(P, id), { project: 'home', started: true })
  fs.rmSync(root, { recursive: true, force: true })
})
