// ~/.claude/projects/<id>.jsonl を直接読み、その会話がCLI上で実際に持っている事実だけを
// 導出する純関数群（v2.14.0）。pocket-claudeは独自のsessionメタデータを持たない。
//
// 設計指針「薄いラッパーはCLIが持つ事実を自前で持たない」に従い、新規・保持するファイルはゼロ。
// 必要なproject/model/effortはすべて本体jsonlから読み取る。

const fs = require('fs')
const path = require('path')
const config = require('../config/index')
const { CLAUDE_PROJECTS_DIR } = require('./claude-dir')
const { UUID_RE } = require('./history')

// 指定された会話jsonlから事実を読み取る。
// 各フィールドは「最初に見つかった有効値」を用いる（v2.14.0）。
//   - cwd: 最初の type:user 行（またはcwdを持つ行）の cwd
//   - modelId: attachment.type==='model' 行の identity.modelId（多くのjsonlに無い→null）
//   - model/effort: 最後の type:assistant 行の message.model / effort
function readSessionFacts(id) {
  const filePath = path.join(CLAUDE_PROJECTS_DIR, `${id}.jsonl`)
  return _readSessionFacts(filePath)
}

function _readSessionFacts(filePath) {
  let lines
  try {
    lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(l => l.trim())
  } catch {
    return { cwd: null, modelId: null, model: null, effort: null }
  }

  let cwd = null
  let modelId = null
  let model = null
  let effort = null

  for (const line of lines) {
    let entry
    try { entry = JSON.parse(line) } catch { continue }
    if (!entry || typeof entry !== 'object') continue

    if (cwd === null && typeof entry.cwd === 'string' && entry.cwd) {
      cwd = entry.cwd
    }

    if (modelId === null && entry.attachment && entry.attachment.type === 'model' &&
        entry.attachment.identity && typeof entry.attachment.identity.modelId === 'string') {
      modelId = entry.attachment.identity.modelId
    }

    if (entry.type === 'assistant' && entry.message) {
      if (typeof entry.message.model === 'string') {
        model = entry.message.model
      }
      if (typeof entry.effort === 'string') {
        effort = entry.effort
      }
    }
  }

  return { cwd, modelId, model, effort }
}

// configs.models に対し、候補 [modelId, model] の順にマッチングする。
// 完全一致または value を最初の ',' で割った後半と一致する場合（例:
//   cloudflare-paid,@cf/x ⇔ @cf/x
function matchConfigModel(facts, models) {
  if (!Array.isArray(models) || models.length === 0) return null
  const candidates = [facts.modelId, facts.model].filter(v => typeof v === 'string' && v)
  for (const v of candidates) {
    for (const m of models) {
      if (typeof m.value !== 'string') continue
      if (m.value === v) return m.value
      const idx = m.value.indexOf(',')
      if (idx >= 0) {
        const back = m.value.slice(idx + 1)
        if (back === v) return m.value
      }
    }
  }
  return null
}

// cwd を config.projects の値で逆引きする。exact > 最長prefix。
// どれにも該当しなければ null。
function projectFromCwd(cwd, projects) {
  if (!cwd || typeof cwd !== 'string') return null
  const entries = Object.entries(projects || {})
  const exact = entries.find(([, v]) => v === cwd)
  if (exact) return exact[0]
  const prefix = entries.filter(([, v]) => cwd.startsWith(v + path.sep))
  if (prefix.length === 0) return null
  prefix.sort((a, b) => b[1].length - a[1].length)
  return prefix[0][0]
}

// sessionId があって、かつ本体jsonlが見つからないことを確認できる場合のみ true。
function sessionExists(id) {
  return UUID_RE.test(id) && fs.existsSync(path.join(CLAUDE_PROJECTS_DIR, `${id}.jsonl`))
}

module.exports = { readSessionFacts, _readSessionFacts, matchConfigModel, projectFromCwd, sessionExists }
