// 起動時マイグレーション（v2.12.0・schema version 1）
//
// 目的: pocket session ID と Claude session ID の二重身分を廃止する。
//   - 正規ID = Claude session ID（= 履歴一覧のID = ~/.claude/projects/<id>.jsonl の名前。改名不可）
//   - 分裂レコード（sessions/<pocketId>.json に claudeSessionId!=pocketId）を
//     sessions/<claudeId>.json へ寄せ、旧pocket IDには転送スタブ {movedTo} を永久に残す
//     （各端末localStorageのタブ救済）。
//   - schedules.json / scheduled-posts.json の旧pocket IDキーを正規IDへ貼り替える。
//   - 本体側に対応jsonlが無い pocketライブログ（死蔵分）と、会話終了済みで冗長なログを削除する（4b/4a）。
//
// 安全策: 冪等（sessions/.schema.json でバージョン管理）／変換前に tar.gz 退避／
//         全レコード・全フィールド衝突を起動ログへ出力／dryRun で件数だけ先に確認。
//
// フィールド衝突の解決規則: フィールドごとのルールを持たない。
//   pocket側レコードを丸ごと正典とし、pocket側に無いフィールドだけ self 側から補完する。
//   （食い違いの原因がこのバグ自身であり、フィールド単位の分岐を作るとフィールドが
//     増えるたびにルールが増えるため。移行の役割は過去の事実の保存であって訂正ではない
//     ＝例えば project:"reports" で走った会話は "reports" のまま残す。）

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { writeJsonAtomic } = require('./persist')
const { UUID_RE, CLAUDE_PROJECTS_DIR } = require('./history')

const SCHEMA_VERSION = 1
const MERGE_FIELDS = ['project', 'model', 'effort', 'thinking', 'draftPrompt', 'started']

function defaultPaths() {
  const ROOT = path.join(__dirname, '..')
  return {
    ROOT,
    SESSIONS_DIR: path.join(ROOT, 'sessions'),
    LOGS_DIR: path.join(ROOT, 'logs'),
    SCHEMA_FILE: path.join(ROOT, 'sessions', '.schema.json'),
    SCHEDULES_FILE: path.join(ROOT, 'schedules.json'),
    POSTS_FILE: path.join(ROOT, 'scheduled-posts.json'),
    CLAUDE_PROJECTS_DIR,
  }
}
function resolvePaths(override) {
  return Object.assign(defaultPaths(), override || {})
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}
function isExplicit(v) { return v !== undefined && v !== null && v !== '' }
function mtimeMs(file) { try { return fs.statSync(file).mtimeMs } catch { return 0 } }
function sizeOf(file) { try { return fs.statSync(file).size } catch { return 0 } }

// sessions/ を走査し、分裂レコード（pocketId != claudeSessionId）を列挙する。
function scanSplits(P) {
  let files = []
  try { files = fs.readdirSync(P.SESSIONS_DIR).filter(f => f.endsWith('.json') && f !== '.schema.json') } catch { return [] }
  const splits = []
  for (const f of files) {
    const pocketId = f.slice(0, -'.json'.length)
    if (!UUID_RE.test(pocketId)) continue
    const data = readJson(path.join(P.SESSIONS_DIR, f), null)
    if (!data || typeof data !== 'object') continue
    if (data.movedTo) continue // 既に転送スタブ（再実行時 = 冪等）
    const claudeId = data.claudeSessionId
    if (!claudeId || !UUID_RE.test(claudeId) || claudeId === pocketId) continue
    splits.push({ pocketId, claudeId, data })
  }
  return splits
}

// フィールド単位の衝突解決。戻り値 { merged, conflicts:[{field,chosen,loser}] }
function mergeFields(pocket, self) {
  const merged = {}
  const conflicts = []
  const keys = new Set([...Object.keys(pocket || {}), ...Object.keys(self || {})])
  keys.delete('claudeSessionId')
  keys.delete('movedTo')
  for (const k of keys) {
    const pv = pocket ? pocket[k] : undefined
    const sv = self ? self[k] : undefined
    const pe = isExplicit(pv)
    const se = isExplicit(sv)
    if (pe && se && JSON.stringify(pv) !== JSON.stringify(sv)) {
      merged[k] = pv // 両方明示で相違 → pocket側（オリジナル）
      conflicts.push({ field: k, chosen: pv, loser: sv })
    } else if (pe) merged[k] = pv
    else if (se) merged[k] = sv
    else if (pv !== undefined) merged[k] = pv
    else if (sv !== undefined) merged[k] = sv
  }
  return { merged, conflicts }
}

function logEndsWithDone(P, id) {
  try {
    const lines = fs.readFileSync(path.join(P.LOGS_DIR, `${id}.jsonl`), 'utf8').split('\n').filter(l => l.trim())
    for (let i = lines.length - 1; i >= 0; i--) {
      try { return JSON.parse(lines[i]).type === 'done' } catch {}
    }
  } catch {}
  return false
}

function analyze(P) {
  P = resolvePaths(P)
  const splits = scanSplits(P)

  let mainJsonlSet = new Set()
  try { mainJsonlSet = new Set(fs.readdirSync(P.CLAUDE_PROJECTS_DIR).filter(f => f.endsWith('.jsonl')).map(f => f.slice(0, -6))) } catch {}
  let logSet = new Set()
  try { logSet = new Set(fs.readdirSync(P.LOGS_DIR).filter(f => f.endsWith('.jsonl')).map(f => f.slice(0, -6))) } catch {}

  let selfRecordExists = 0
  let bothLogs = 0
  const conflictsByField = {}
  let recordsWithAnyConflict = 0
  const conflictDetails = []
  const pocketIdSet = new Set(splits.map(s => s.pocketId))

  for (const s of splits) {
    const selfPath = path.join(P.SESSIONS_DIR, `${s.claudeId}.json`)
    const selfRaw = fs.existsSync(selfPath) ? readJson(selfPath, null) : null
    const self = (selfRaw && !selfRaw.movedTo) ? selfRaw : null
    if (self) selfRecordExists++

    if (logSet.has(s.pocketId) && mainJsonlSet.has(s.claudeId)) bothLogs++

    const { conflicts } = mergeFields({ ...s.data }, self)
    if (conflicts.length) {
      recordsWithAnyConflict++
      for (const c of conflicts) {
        conflictsByField[c.field] = (conflictsByField[c.field] || 0) + 1
        conflictDetails.push({ pocketId: s.pocketId, claudeId: s.claudeId, ...c })
      }
    }
  }

  const orphanLogs = []
  const redundantLogs = []
  for (const id of logSet) {
    if (pocketIdSet.has(id)) continue // 分裂ぶんは split ループで削除
    if (!mainJsonlSet.has(id)) { orphanLogs.push(id); continue }
    if (logEndsWithDone(P, id)) redundantLogs.push(id)
  }
  const splitPocketLogs = splits.filter(s => logSet.has(s.pocketId)).map(s => s.pocketId)
  const bytesOf = ids => ids.reduce((n, id) => n + sizeOf(path.join(P.LOGS_DIR, `${id}.jsonl`)), 0)

  return {
    splits,
    counts: { split: splits.length, selfRecordExists, bothLogs, recordsWithAnyConflict },
    conflictsByField, conflictDetails,
    logGC: {
      orphanLogs, redundantLogs, splitPocketLogs,
      orphanBytes: bytesOf(orphanLogs),
      redundantBytes: bytesOf(redundantLogs),
      splitPocketBytes: bytesOf(splitPocketLogs),
    },
  }
}

function tarBackup(P) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const tarPath = path.join(P.ROOT, `migration-backup-${stamp}.tar.gz`)
  const items = []
  for (const rel of ['sessions', 'logs', 'schedules.json', 'scheduled-posts.json']) {
    if (fs.existsSync(path.join(P.ROOT, rel))) items.push(rel)
  }
  execFileSync('tar', ['-czf', tarPath, '-C', P.ROOT, ...items], { stdio: 'ignore' })
  return { tarPath, size: sizeOf(tarPath), items }
}

function rekeyScheduleFile(file, rekey, log) {
  if (!fs.existsSync(file)) return
  const data = readJson(file, null)
  if (!data || typeof data !== 'object') return
  let changed = false
  for (const [oldId, newId] of Object.entries(rekey)) {
    if (Object.prototype.hasOwnProperty.call(data, oldId)) {
      if (Object.prototype.hasOwnProperty.call(data, newId)) {
        log(`schedules: key collision ${oldId}->${newId}, keeping pocket-side (original)`)
      }
      data[newId] = data[oldId]
      delete data[oldId]
      changed = true
      log(`schedules: rekeyed ${oldId} -> ${newId}`)
    }
  }
  if (changed) writeJsonAtomic(file, data)
}

function rekeyPostsFile(file, rekey, log) {
  if (!fs.existsSync(file)) return
  const data = readJson(file, null)
  if (!data || typeof data !== 'object') return
  let changed = false
  for (const p of Object.values(data)) {
    if (p && rekey[p.sessionId]) {
      log(`scheduled-posts: post ${p.id} sessionId ${p.sessionId} -> ${rekey[p.sessionId]}`)
      p.sessionId = rekey[p.sessionId]
      changed = true
    }
  }
  if (changed) writeJsonAtomic(file, data, { pretty: true })
}

function apply(P, analysis) {
  const log = (...a) => console.log('[migrate]', ...a)
  const backup = tarBackup(P)
  log(`backup: ${backup.tarPath} (${(backup.size / 1024 / 1024).toFixed(1)}MB, items: ${backup.items.join(', ')})`)

  const rekey = {}
  // mtime昇順（同じ claudeId に複数 pocket が紐づく場合、新しい方の値が最後に勝つ）
  const splits = analysis.splits.slice().sort((a, b) =>
    mtimeMs(path.join(P.SESSIONS_DIR, `${a.pocketId}.json`)) - mtimeMs(path.join(P.SESSIONS_DIR, `${b.pocketId}.json`)))

  let merged = 0
  for (const s of splits) {
    const pocketPath = path.join(P.SESSIONS_DIR, `${s.pocketId}.json`)
    const selfPath = path.join(P.SESSIONS_DIR, `${s.claudeId}.json`)
    const selfRaw = fs.existsSync(selfPath) ? readJson(selfPath, null) : null
    const self = (selfRaw && !selfRaw.movedTo) ? selfRaw : null

    const { merged: rec, conflicts } = mergeFields({ ...s.data }, self)
    for (const c of conflicts) {
      log(`conflict ${s.pocketId}->${s.claudeId} field=${c.field} chosen=${JSON.stringify(c.chosen)} loser=${JSON.stringify(c.loser)}`)
    }

    const newest = Math.max(mtimeMs(pocketPath), mtimeMs(selfPath)) / 1000
    writeJsonAtomic(selfPath, rec)
    try { if (newest) fs.utimesSync(selfPath, newest, newest) } catch {}

    try { fs.unlinkSync(path.join(P.LOGS_DIR, `${s.pocketId}.jsonl`)) } catch {}
    writeJsonAtomic(pocketPath, { movedTo: s.claudeId, schemaVersion: SCHEMA_VERSION })
    rekey[s.pocketId] = s.claudeId
    merged++
    log(`migrated ${s.pocketId} -> ${s.claudeId}${self ? ' (merged into existing self-record)' : ''}`)
  }
  log(`records migrated: ${merged}`)

  rekeyScheduleFile(P.SCHEDULES_FILE, rekey, log)
  rekeyPostsFile(P.POSTS_FILE, rekey, log)

  let gcCount = 0, gcBytes = 0
  for (const id of [...analysis.logGC.orphanLogs, ...analysis.logGC.redundantLogs]) {
    const p = path.join(P.LOGS_DIR, `${id}.jsonl`)
    gcBytes += sizeOf(p)
    try { fs.unlinkSync(p); gcCount++ } catch {}
  }
  log(`log GC: deleted ${gcCount} file(s), ~${(gcBytes / 1024 / 1024).toFixed(1)}MB ` +
    `(orphan ${analysis.logGC.orphanLogs.length} + redundant ${analysis.logGC.redundantLogs.length}; ` +
    `+ ${analysis.logGC.splitPocketLogs.length} split pocket logs removed above)`)

  writeJsonAtomic(P.SCHEMA_FILE, {
    version: SCHEMA_VERSION,
    migratedAt: new Date().toISOString(),
    recordsMigrated: merged,
    logsDeleted: gcCount + analysis.logGC.splitPocketLogs.length,
    backup: path.basename(backup.tarPath),
  })
  log(`done. schema -> v${SCHEMA_VERSION}`)
  return { recordsMigrated: merged, logsDeleted: gcCount + analysis.logGC.splitPocketLogs.length, backup: backup.tarPath }
}

// runStartupMigration({ dryRun, paths })
//   dryRun=true : 何も書かず分析結果を返す
//   dryRun=false: schema未達なら実行。schema到達済みなら skip（冪等）
function runStartupMigration(opts = {}) {
  const P = resolvePaths(opts.paths)
  const dryRun = !!opts.dryRun
  const schema = readJson(P.SCHEMA_FILE, { version: 0 })

  if (!dryRun && schema.version >= SCHEMA_VERSION) {
    return { skipped: true, schemaVersion: schema.version }
  }

  const analysis = analyze(P)

  if (dryRun) {
    return {
      dryRun: true,
      schemaVersion: schema.version,
      counts: analysis.counts,
      conflictsByField: analysis.conflictsByField,
      conflictDetails: analysis.conflictDetails,
      logGC: {
        orphanLogs: analysis.logGC.orphanLogs.length,
        orphanMB: +(analysis.logGC.orphanBytes / 1024 / 1024).toFixed(1),
        redundantLogs: analysis.logGC.redundantLogs.length,
        redundantMB: +(analysis.logGC.redundantBytes / 1024 / 1024).toFixed(1),
        splitPocketLogs: analysis.logGC.splitPocketLogs.length,
        splitPocketMB: +(analysis.logGC.splitPocketBytes / 1024 / 1024).toFixed(1),
      },
      willTar: ['sessions', 'logs', 'schedules.json', 'scheduled-posts.json']
        .filter(r => fs.existsSync(path.join(P.ROOT, r))),
    }
  }

  console.log(`[migrate] starting v${SCHEMA_VERSION}: split=${analysis.counts.split} ` +
    `selfRecordExists=${analysis.counts.selfRecordExists} bothLogs=${analysis.counts.bothLogs} ` +
    `recordsWithAnyConflict=${analysis.counts.recordsWithAnyConflict}`)
  const result = apply(P, analysis)
  return { applied: true, counts: analysis.counts, ...result }
}

module.exports = { runStartupMigration, analyze, mergeFields, resolvePaths, SCHEMA_VERSION, MERGE_FIELDS }
