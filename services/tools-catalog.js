const fs = require('fs')
const path = require('path')
const { writeJsonAtomic } = require('./persist')

// claude CLIが実際に持つツール名一覧をキャッシュするカタログ。ハードコードした固定リストは
// CLIのバージョンアップで新ツールが増減すると陳腐化する（実例: 旧PROXY_DISALLOWED_DEFAULTの
// 23個リストに存在しないTask*系ツール名が混入していた）。system/init イベントの `tools` フィールドが
// そのプロセスが実際に持つツール名の正なので、セッション起動のたびにここへ保存し、
// 設定モーダルのチェックボックス一覧描画に使う。
const CATALOG_FILE = path.join(__dirname, '..', 'tools-catalog.json')

// init イベントから取得したツール名一覧を保存する。呼び出し元(spawner.js)のセッション起動を
// 壊さないよう、失敗しても例外を投げない(呼び出し元でtry/catch不要)。
function saveToolsCatalog(tools) {
  if (!Array.isArray(tools)) return false
  try {
    return writeJsonAtomic(CATALOG_FILE, { tools, fetchedAt: new Date().toISOString() })
  } catch (err) {
    console.warn('[tools-catalog] failed to save:', err.message)
    return false
  }
}

// 保存済みのツール名一覧を返す。未取得・破損時は空配列。
function loadToolsCatalog() {
  try {
    const data = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'))
    return Array.isArray(data.tools) ? data.tools : []
  } catch {
    return []
  }
}

module.exports = { saveToolsCatalog, loadToolsCatalog, CATALOG_FILE }
