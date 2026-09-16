const fs = require('fs')
const path = require('path')

// 旧形式pocketログ（v2.12.x、log_start.mainLines境界方式）を v2.15.0 の after 形式へ
// 一括変換する。directories.js からの呼び出しは A2 で行う（ここでは関数とテストだけ）。
//
// 用語（services/history.js と同じ）:
//  - A ＝ 本体jsonl ~/.claude/projects/<id>.jsonl（非空行番号a、各行にuuid）
//  - B ＝ pocketログ logs/<id>.jsonl（非空行番号b）
// v2.15.0のBは各行に after: <uuid|null>（＝直前のA行のuuid）を持つ。
// Bの会話イベント（assistant/user）はAの行と同じuuidを持つため、旧B内にassistant/userが
// 現れた時点で「直前のA行uuid」はそのuuidに等しくなる。

// 旧Bから新形式へ変換する純関数。
// lines: 旧Bの行オブジェクト配列（パース済み）
// mainEntries: Aの行オブジェクト配列（パース済み）
// 戻り値: 新形式の行オブジェクト配列。先頭行が log_start でない入力は変換せずそのまま返す（冪等）。
//
// 残す型: start / done / interrupted / error / stderr / raw /
//        system{text または subtype:'init'} / result / assistant{error:'rate_limit'}
// 捨てる型: log_start / user_input / stream_event / その他の assistant・user /
//          system（text無し・init以外）/ rate_limit_event
// 各残す行に after を付ける: 旧B内でその行より前に最後に現れた assistant/user の uuid。
// まだ無ければ log_start.mainLines-1 番目の mainEntries の uuid
// （mainLines 0／範囲外／A 無し→null）。
function convertLegacyLog(lines, mainEntries) {
  const first = Array.isArray(lines) ? lines[0] : null
  if (!first || typeof first !== 'object' || first.type !== 'log_start') {
    return Array.isArray(lines) ? lines : []
  }

  const entries = Array.isArray(mainEntries) ? mainEntries : []
  const mainLines = typeof first.mainLines === 'number' ? first.mainLines : 0
  const fallbackUuid =
    mainLines > 0 && entries[mainLines - 1] && typeof entries[mainLines - 1] === 'object'
      ? (entries[mainLines - 1].uuid != null ? entries[mainLines - 1].uuid : null)
      : null

  let lastUuid = fallbackUuid
  const out = []
  for (const line of lines) {
    if (!line || typeof line !== 'object') continue
    const t = line.type

    if (t === 'log_start') continue

    // 実測: B内のassistant/userはAの行と同じuuidを持つ。捨てるassistant/userであっても
    // uuidがあれば「直前のA行uuid」の追跡に使う（result等のafter精度が上がる）。
    if ((t === 'assistant' || t === 'user') && line.uuid != null) {
      lastUuid = line.uuid
    }

    let keep = false
    if (t === 'start' || t === 'done' || t === 'interrupted' || t === 'error' ||
        t === 'stderr' || t === 'raw' || t === 'result') {
      keep = true
    } else if (t === 'system') {
      keep = typeof line.text === 'string' || line.subtype === 'init'
    } else if (t === 'assistant') {
      keep = line.error === 'rate_limit'
    }
    // user_input / stream_event / rate_limit_event / その他の assistant・user・system は捨てる

    if (!keep) continue

    out.push(Object.assign({}, line, { after: lastUuid != null ? lastUuid : null }))
  }
  return out
}

// logsDir配下の各 *.jsonl を走査し、先頭行が log_start のものだけ変換して
// tmp→rename で書き換える。対象外（既に新形式・他形式）は触らない。
// projectsDir: A（本体jsonl）の置き場所。
function migrateLegacyLogs(logsDir, projectsDir) {
  let files
  try {
    files = fs.readdirSync(logsDir).filter(f => f.endsWith('.jsonl'))
  } catch {
    return []
  }

  const migrated = []
  for (const file of files) {
    const logPath = path.join(logsDir, file)
    let raw
    try {
      raw = fs.readFileSync(logPath, 'utf8')
    } catch {
      continue
    }
    const rawLines = raw.split('\n').filter(l => l.trim())
    let first
    try {
      first = JSON.parse(rawLines[0])
    } catch {
      continue
    }
    if (!first || first.type !== 'log_start') continue

    const sessionId = file.replace(/\.jsonl$/, '')
    let mainRawLines = []
    try {
      mainRawLines = fs.readFileSync(path.join(projectsDir, `${sessionId}.jsonl`), 'utf8').split('\n')
    } catch {}
    const mainEntries = mainRawLines
      .filter(l => l && l.trim())
      .map(l => {
        try { return JSON.parse(l) } catch { return null }
      })
      .filter(Boolean)

    const lines = rawLines.map(l => {
      try { return JSON.parse(l) } catch { return null }
    }).filter(Boolean)
    const converted = convertLegacyLog(lines, mainEntries)
    const body = converted.map(l => JSON.stringify(l)).join('\n') + '\n'
    const tmpPath = logPath + '.tmp'
    try {
      fs.writeFileSync(tmpPath, body)
      fs.renameSync(tmpPath, logPath)
      migrated.push(file)
    } catch {
      try { fs.unlinkSync(tmpPath) } catch {}
    }
  }
  return migrated
}

module.exports = { convertLegacyLog, migrateLegacyLogs }
