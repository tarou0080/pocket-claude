const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { convertLegacyLog, migrateLegacyLogs } = require('../services/log-migrate')

// convertLegacyLog(): 旧形式pocketログ（log_start.mainLines境界方式）を v2.15.0 の
// after形式へ変換する純関数。

test('log_start→user_input→stream_event→assistant→result→done を変換する', () => {
  const input = [
    { type: 'log_start', mainLines: 2 },
    { type: 'user_input', text: 'hi' },
    { type: 'stream_event', event: { type: 'content_block_delta' } },
    { type: 'assistant', uuid: 'u1', message: { content: [] } },
    { type: 'result' },
    { type: 'done' },
  ]
  const mainEntries = [{ uuid: 'm0' }, { uuid: 'm1' }]
  const out = convertLegacyLog(input, mainEntries)
  // user_input/stream_event/log_startは捨てられ、assistant(rate_limit以外)も捨てられる。
  // result/doneのafterは「直前に現れたassistant/userのuuid」＝u1。
  assert.deepEqual(out, [
    { type: 'result', after: 'u1' },
    { type: 'done', after: 'u1' },
  ])
})

test('log_start直後のstartのafterはmainLines-1番目のmainEntriesのuuid', () => {
  const input = [
    { type: 'log_start', mainLines: 2 },
    { type: 'start' },
    { type: 'assistant', uuid: 'u1', message: { content: [] } },
  ]
  const mainEntries = [{ uuid: 'm0' }, { uuid: 'm1' }]
  const out = convertLegacyLog(input, mainEntries)
  assert.deepEqual(out, [
    { type: 'start', after: 'm1' },
  ])
})

test('mainLines=0／範囲外／A無しのときafterはnull', () => {
  const mainEntries = [{ uuid: 'm0' }, { uuid: 'm1' }]
  assert.deepEqual(convertLegacyLog([{ type: 'log_start', mainLines: 0 }, { type: 'start' }], mainEntries),
    [{ type: 'start', after: null }])
  assert.deepEqual(convertLegacyLog([{ type: 'log_start', mainLines: 5 }, { type: 'start' }], mainEntries),
    [{ type: 'start', after: null }])
  assert.deepEqual(convertLegacyLog([{ type: 'log_start', mainLines: 2 }, { type: 'start' }], []),
    [{ type: 'start', after: null }])
})

test('残す型: interrupted/error/stderr/raw/system(text)/system(init)/assistant(rate_limit)', () => {
  const input = [
    { type: 'log_start', mainLines: 0 },
    { type: 'interrupted' },
    { type: 'error', message: 'x' },
    { type: 'stderr', text: 'y' },
    { type: 'raw', data: 'z' },
    { type: 'system', text: 'note' },
    { type: 'system', subtype: 'init' },
    { type: 'assistant', error: 'rate_limit' },
    { type: 'system', subtype: 'other' },
    { type: 'rate_limit_event' },
    { type: 'user', uuid: 'u9', message: { content: [] } },
  ]
  const out = convertLegacyLog(input, [])
  assert.deepEqual(out.map(l => l.type),
    ['interrupted', 'error', 'stderr', 'raw', 'system', 'system', 'assistant'])
  // 捨てられたassistant(rate_limit)より前にassistant/userは無い→afterはnull
  assert.equal(out.find(l => l.type === 'assistant').after, null)
})

test('捨てる型でも user のuuidは直前A行の追跡に使われる', () => {
  const input = [
    { type: 'log_start', mainLines: 0 },
    { type: 'user', uuid: 'u9', message: { content: [] } },
    { type: 'assistant', error: 'rate_limit' },
    { type: 'result' },
  ]
  const out = convertLegacyLog(input, [])
  assert.deepEqual(out, [
    { type: 'assistant', error: 'rate_limit', after: 'u9' },
    { type: 'result', after: 'u9' },
  ])
})

test('冪等: 変換済み出力を再入力しても同じ結果', () => {
  const input = [
    { type: 'log_start', mainLines: 2 },
    { type: 'start' },
    { type: 'assistant', uuid: 'u1', message: { content: [] } },
    { type: 'result' },
    { type: 'done' },
  ]
  const mainEntries = [{ uuid: 'm0' }, { uuid: 'm1' }]
  const once = convertLegacyLog(input, mainEntries)
  const twice = convertLegacyLog(once, mainEntries)
  assert.deepEqual(twice, once)
})

test('先頭行がlog_startでない入力は変換せずそのまま返す', () => {
  const input = [{ type: 'start', after: 'x' }, { type: 'done', after: 'x' }]
  const out = convertLegacyLog(input, [])
  assert.equal(out, input)
})

// migrateLegacyLogs(): 実ディレクトリに対する一括変換（tmp→rename）。

function makeTmpDirs() {
  const logsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-logs-'))
  const projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-proj-'))
  return { logsDir, projectsDir }
}

test('migrateLegacyLogs: log_startのファイルだけ変換し、対象外は触らない', () => {
  const { logsDir, projectsDir } = makeTmpDirs()
  try {
    // 旧形式 → 変換対象
    const legacy = [
      { type: 'log_start', mainLines: 2 },
      { type: 'start' },
      { type: 'result' },
    ]
    fs.writeFileSync(path.join(logsDir, 'id-a.jsonl'), legacy.map(l => JSON.stringify(l)).join('\n') + '\n')
    // A（本体jsonl）
    fs.writeFileSync(path.join(projectsDir, 'id-a.jsonl'),
      [{ uuid: 'm0' }, { uuid: 'm1' }].map(l => JSON.stringify(l)).join('\n') + '\n')
    // 新形式（after付き）→ 対象外
    fs.writeFileSync(path.join(logsDir, 'id-b.jsonl'), JSON.stringify({ type: 'start', after: null }) + '\n')
    // log_startでない → 対象外
    fs.writeFileSync(path.join(logsDir, 'id-c.jsonl'), JSON.stringify({ type: 'user_input', text: 'x' }) + '\n')

    const migrated = migrateLegacyLogs(logsDir, projectsDir)
    assert.deepEqual(migrated, ['id-a.jsonl'])

    const outLines = fs.readFileSync(path.join(logsDir, 'id-a.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l))
    assert.deepEqual(outLines, [
      { type: 'start', after: 'm1' },
      { type: 'result', after: 'm1' },
    ])
    // 対象外は無傷
    assert.equal(JSON.parse(fs.readFileSync(path.join(logsDir, 'id-b.jsonl'), 'utf8').trim()).after, null)
    assert.equal(JSON.parse(fs.readFileSync(path.join(logsDir, 'id-c.jsonl'), 'utf8').trim()).text, 'x')
    // tmpファイルが残らない
    assert.deepEqual(fs.readdirSync(logsDir).filter(f => f.endsWith('.tmp')), [])
  } finally {
    fs.rmSync(logsDir, { recursive: true, force: true })
    fs.rmSync(projectsDir, { recursive: true, force: true })
  }
})

test('migrateLegacyLogs: 本体jsonlが無いセッションはafter=nullで変換する', () => {
  const { logsDir, projectsDir } = makeTmpDirs()
  try {
    fs.writeFileSync(path.join(logsDir, 'id-a.jsonl'),
      [{ type: 'log_start', mainLines: 3 }, { type: 'start' }].map(l => JSON.stringify(l)).join('\n') + '\n')
    const migrated = migrateLegacyLogs(logsDir, projectsDir)
    assert.deepEqual(migrated, ['id-a.jsonl'])
    const outLines = fs.readFileSync(path.join(logsDir, 'id-a.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l))
    assert.deepEqual(outLines, [{ type: 'start', after: null }])
  } finally {
    fs.rmSync(logsDir, { recursive: true, force: true })
    fs.rmSync(projectsDir, { recursive: true, force: true })
  }
})

test('migrateLegacyLogs: logsDirが無ければ空配列', () => {
  assert.deepEqual(migrateLegacyLogs('/nonexistent-logs-dir-xyz', '/nonexistent-proj-xyz'), [])
})
