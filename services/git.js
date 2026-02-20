const { exec } = require('child_process')
const fs = require('fs')
const path = require('path')

// git pull（.git があるディレクトリのみ）
function gitPull(dir) {
  return new Promise(resolve => {
    if (!fs.existsSync(path.join(dir, '.git'))) return resolve(null)
    exec('git pull --ff-only', { cwd: dir, timeout: 30000 }, (err, stdout, stderr) => {
      if (err) return resolve(`pull failed: ${stderr.trim()}`)
      const msg = stdout.trim()
      resolve(msg && msg !== 'Already up to date.' ? msg : null)
    })
  })
}

module.exports = { gitPull }
