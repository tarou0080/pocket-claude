const path = require('path')

// 許可されたプロジェクトベースディレクトリ（Path Traversal対策）
const ALLOWED_BASE_DIRS = [
  path.resolve(process.env.HOME || '/home/user'),
  ...(process.env.ADDITIONAL_ALLOWED_DIRS
    ? process.env.ADDITIONAL_ALLOWED_DIRS.split(':').map(p => path.resolve(p))
    : [])
]

// セキュリティチェック: パスが許可されたディレクトリ内か確認
function isPathAllowed(realPath) {
  return ALLOWED_BASE_DIRS.some(allowed =>
    realPath === allowed || realPath.startsWith(allowed + path.sep)
  )
}

module.exports = { isPathAllowed, ALLOWED_BASE_DIRS }
