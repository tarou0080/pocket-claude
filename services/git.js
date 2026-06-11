const { exec } = require('child_process')
const fs = require('fs')
const path = require('path')

// git pull（.git があるディレクトリのみ）
function gitPull(dir) {
  return new Promise(resolve => {
    if (!fs.existsSync(path.join(dir, '.git'))) return resolve(null)
    // --no-verify: リポジトリの hook（post-merge 等）の発火を防ぐ
    // GIT_TERMINAL_PROMPT=0: 認証待ちでハングさせない
    exec('git pull --ff-only --no-verify', {
      cwd: dir,
      timeout: 30000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }, (err, stdout, stderr) => {
      if (err) return resolve(`pull failed: ${stderr.trim()}`)
      const msg = stdout.trim()
      resolve(msg && msg !== 'Already up to date.' ? msg : null)
    })
  })
}

module.exports = { gitPull }
