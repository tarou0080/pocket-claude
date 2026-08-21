const fs = require('fs')
const path = require('path')

// JSONファイルを原子的に書き込む（同一ディレクトリの一時ファイルへ書いてから rename）。
// tmp→renameにすることで、書き込み中のプロセスkill/クラッシュで対象ファイルが
// 壊れる（中身が半端なJSONになる）窓を無くす。
// 失敗時は理由を console.error に残し、呼び出し元へ失敗を返す（例外は投げず false を返す。
// 既存の try{}catch{} 呼び出し元がそのまま if 判定へ置き換えられる形に合わせた）。
function writeJsonAtomic(file, data, { pretty = false } = {}) {
  const dir = path.dirname(file)
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`)
  try {
    const json = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data)
    fs.writeFileSync(tmp, json)
    fs.renameSync(tmp, file)
    return true
  } catch (err) {
    console.error(`[persist] Failed to write ${file}:`, err.message)
    try { fs.unlinkSync(tmp) } catch {}
    return false
  }
}

module.exports = { writeJsonAtomic }
