// モデル一覧の唯一の出どころ（v2.17.0）。
// 一覧と表示名は config.json（無ければ下の既定）が正。フロントは受け取ったものをそのまま描く。
// 「エイリアスが今どの具体モデルに当たっているか」「窓の大きさ」はサーバーが見た事実として添える:
// サーバーは自分が --model に渡した値と CLI の応答を両方知っているので、取り違えが起きない。

const fs = require('fs')
const path = require('path')
const config = require('../config/index')

// config.json に models が無いときの一覧。値はエイリアス＝CLI が各ティアの最新へ解決する。
const DEFAULT_MODELS = [
  { value: '',       name: 'Default' },
  { value: 'fable',  name: 'Fable', note: ' (Pro: metered)' },
  { value: 'opus',   name: 'Opus' },
  { value: 'sonnet', name: 'Sonnet' },
  { value: 'haiku',  name: 'Haiku' },
]

// 選択値 → { resolved, contextWindow }。'' は Default（--model を渡さない）。
const facts = new Map()

function configuredModels() {
  return Array.isArray(config.models) && config.models.length > 0 ? config.models : DEFAULT_MODELS
}

function update(value, patch) {
  facts.set(value || '', { ...facts.get(value || ''), ...patch })
}

// CLI が返したモデルID。'<synthetic>' は CLI が内部で差し込む応答でモデルではない。
function noteResolved(value, id) {
  if (typeof id !== 'string' || !id || id === '<synthetic>') return
  update(value, { resolved: id })
}

// result.modelUsage からその選択値の窓を取る。サブエージェント等で複数モデルが載るので、
// 解決先がわかっていればそのモデルの窓を、わからなければ最大を採る。
function noteUsage(value, modelUsage) {
  if (!modelUsage || typeof modelUsage !== 'object') return
  const resolved = facts.get(value || '')?.resolved
  const own = resolved && modelUsage[resolved]?.contextWindow
  const win = own || Math.max(0, ...Object.values(modelUsage).map(u => u?.contextWindow || 0))
  if (win > 0) update(value, { contextWindow: win })
}

// 起動直後の空白を埋める: 事実ログ（logs/<id>.jsonl）の start{model}→system/init{model}・result の組を
// 古い順に流し込む（新しいものが勝つ）。start の model は Default を 'default' と書いている。
// 読むのは新しい方から SEED_FILES 本だけ（v2.15.0 以前のログは stdout 全量で大きい）。
const SEED_FILES = 30
function seedFromLogs(logsDir = config.LOGS_DIR) {
  let files
  try {
    files = fs.readdirSync(logsDir).filter(f => f.endsWith('.jsonl'))
      .map(f => ({ f, t: fs.statSync(path.join(logsDir, f)).mtimeMs }))
      .sort((a, b) => a.t - b.t)
      .slice(-SEED_FILES)
  } catch { return }
  for (const { f } of files) {
    let lines
    try { lines = fs.readFileSync(path.join(logsDir, f), 'utf8').split('\n') } catch { continue }
    // spawner と同じ規則: start 直後の最初の init だけを組にし、以後その会話内で
    // モデルが変わったら（/model）次の start まで窓も記録しない。
    let current = null
    let learned = null
    for (const line of lines) {
      if (!line.includes('"start"') && !line.includes('"init"') && !line.includes('"result"')) continue
      let ev
      try { ev = JSON.parse(line) } catch { continue }
      if (ev.type === 'start' && !ev.external) { current = ev.model === 'default' ? '' : (ev.model || ''); learned = null; continue }
      if (current === null) continue
      if (ev.type === 'system' && ev.subtype === 'init') {
        if (learned === null) { noteResolved(current, ev.model); learned = ev.model }
        else if (ev.model !== learned) current = null
      } else if (ev.type === 'result') noteUsage(current, ev.modelUsage)
    }
  }
}

// pocket が最後にその会話を起動したときの選択値（事実ログの start）。無ければ null。
function lastStartModel(sessionId) {
  let text
  try { text = fs.readFileSync(path.join(config.LOGS_DIR, `${sessionId}.jsonl`), 'utf8') } catch { return null }
  let value = null
  for (const line of text.split('\n')) {
    if (!line.includes('"start"')) continue
    let ev
    try { ev = JSON.parse(line) } catch { continue }
    if (ev.type === 'start' && !ev.external) value = ev.model === 'default' ? '' : (ev.model || '')
  }
  return value
}

// 履歴から開いた会話・自動再開で使う選択値。本体jsonlは解決後のIDしか持たないので
// （opus と固定の claude-opus-5-5 を区別できない）、pocket 自身が渡した値を最優先にする。
// ① 最後の start の値（その後 set_model で別モデルに変えていなければ）
// ② 最後の応答モデルに今当たっている選択値（一覧順）③ 本体jsonlの値との直接一致（外部会話・プロキシ）
function sessionModel(sessionId, sessionFacts) {
  const { matchConfigModel } = require('./session-facts')
  const list = configuredModels()
  const last = sessionFacts && sessionFacts.model
  const start = lastStartModel(sessionId)
  const startOk = start !== null && list.some(m => (m.value || '') === start)
  if (startOk) {
    const r = facts.get(start)?.resolved
    if (!last || !r || r === last) return start
  }
  if (last) {
    const hit = list.find(m => facts.get(m.value || '')?.resolved === last)
    if (hit) return hit.value
  }
  // エイリアスの当たり先がその後変わった場合など、どれにも当たらなければ起動時の値に戻す
  return matchConfigModel(sessionFacts || {}, list) ?? (startOk ? start : null)
}

function listModels() {
  return configuredModels().map(m => ({ ...m, ...facts.get(m.value || '') }))
}

module.exports = { DEFAULT_MODELS, configuredModels, listModels, sessionModel, lastStartModel, noteResolved, noteUsage, seedFromLogs, _facts: facts }
