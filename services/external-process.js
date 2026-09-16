// 指定されたセッションIDを --session-id または --resume で持つ claude プロセスを
// /proc/*/cmdline から探索する（v2.14.0）。pocketがspawnしていない外部会話を検出する用途。
//
// argv[0] のbasename が 'claude' で、かつ --session-id <id> または --resume <id> を
// 含むプロセスの pid を返す。無ければ null。
// テスト容易性のため procDir を注入可能にする。

const fs = require('fs')
const path = require('path')

function findClaudePid(id, procDir = '/proc') {
  if (!id || typeof id !== 'string') return null
  try {
    const entries = fs.readdirSync(procDir)
    for (const ent of entries) {
      if (!/^\d+$/.test(ent)) continue
      const cmdlinePath = path.join(procDir, ent, 'cmdline')
      let raw
      try { raw = fs.readFileSync(cmdlinePath, 'utf8') } catch { continue }
      if (!raw) continue
      const argv = raw.split('\0').filter(s => s)
      if (argv.length === 0) continue
      const base = path.basename(argv[0])
      if (base !== 'claude') continue
      for (let i = 0; i < argv.length - 1; i++) {
        const arg = argv[i]
        if ((arg === '--session-id' || arg === '--resume') && argv[i + 1] === id) {
          return parseInt(ent, 10)
        }
      }
    }
  } catch {}
  return null
}

module.exports = { findClaudePid }
