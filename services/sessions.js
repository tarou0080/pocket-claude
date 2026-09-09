const fs = require('fs')
const path = require('path')
const { writeJsonAtomic } = require('./persist')

const sessionsDir = path.join(__dirname, '..', 'sessions')

// セッションマッピングファイルを読み込む（存在しなければ空オブジェクト）
function loadSessionMeta(sessionId) {
  try {
    return JSON.parse(fs.readFileSync(path.join(sessionsDir, `${sessionId}.json`), 'utf8'))
  } catch { return {} }
}

// 起動時マイグレーションが残す転送用スタブ（`{ movedTo: <claudeId> }`）を1段だけ辿り、
// その会話の正規ID（= Claude session ID = 履歴一覧のID）を返す。スタブでなければ id をそのまま返す。
//
// v2.12.0 以降、新規会話は pocket が採番したUUIDを `--session-id` で渡すため pocket ID === Claude ID。
// マイグレーション済みの旧会話は `sessions/<claudeId>.json` が正規で、各端末のlocalStorageに
// 残った旧pocket IDのタブを救済するために `sessions/<oldPocketId>.json` に転送スタブを永久に残す。
// ここはスタブ1件のO(1)読み取り。逆引きインデックス/全走査は復活させない（規則の実体は1箇所）。
function resolveCanonicalId(id) {
  const meta = loadSessionMeta(id)
  if (meta && typeof meta.movedTo === 'string' && meta.movedTo) return meta.movedTo
  return id
}

// セッションマッピングファイルへ部分更新をマージして保存する
// （project など既存フィールドを壊さずに追記できる）
function saveSessionMeta(sessionId, updates) {
  try {
    fs.mkdirSync(sessionsDir, { recursive: true })
  } catch (err) {
    console.error('[persist] Failed to create sessions dir:', err.message)
    return false
  }
  const current = loadSessionMeta(sessionId)
  return writeJsonAtomic(path.join(sessionsDir, `${sessionId}.json`), { ...current, ...updates })
}

// 初回spawn成功時に立てる。以後 startClaude は `--resume` を使う
// （`--session-id` は既存IDへ再指定すると "already in use" で拒否されるため）。
function markStarted(sessionId) {
  saveSessionMeta(sessionId, { started: true })
}

// セッションに紐づくプロジェクト名を取得
function getSessionProject(sessionId) {
  return loadSessionMeta(sessionId).project || null
}

// セッションに紐づくプロジェクト名を保存
function saveSessionProject(sessionId, project) {
  if (!project) return
  saveSessionMeta(sessionId, { project })
}

// セッションに紐づく設定一式（project/model/effort/thinking）を取得。
// 自動再開・予約投稿のように「呼び出し元が引数を渡し忘れる/古い値のまま」でも
// 最後にそのタブで使われていた設定へフォールバックできるようにするための救済経路。
function getSessionSettings(sessionId) {
  const m = loadSessionMeta(sessionId)
  return {
    project: m.project || null,
    model: m.model || null,
    effort: m.effort || null,
    thinking: m.thinking !== undefined ? m.thinking : null,
  }
}

// セッションに紐づく設定一式を保存（渡されたキーのみ部分更新）
function saveSessionSettings(sessionId, { project, model, effort, thinking } = {}) {
  const updates = {}
  if (project !== undefined) updates.project = project
  if (model !== undefined) updates.model = model
  if (effort !== undefined) updates.effort = effort
  if (thinking !== undefined) updates.thinking = thinking
  if (Object.keys(updates).length) saveSessionMeta(sessionId, updates)
}

module.exports = {
  loadSessionMeta,
  resolveCanonicalId,
  markStarted,
  getSessionProject,
  saveSessionProject,
  getSessionSettings,
  saveSessionSettings,
}
