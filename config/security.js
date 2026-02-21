const path = require('path')

// 許可されたプロジェクトベースディレクトリ（Path Traversal対策）
const ALLOWED_BASE_DIRS = [
  path.resolve(process.env.HOME || '/home/user'),
  path.resolve('/srv/shell')
]

// セキュリティチェック: パスが許可されたディレクトリ内か確認
function isPathAllowed(realPath) {
  return ALLOWED_BASE_DIRS.some(allowed =>
    realPath === allowed || realPath.startsWith(allowed + path.sep)
  )
}

module.exports = { isPathAllowed, ALLOWED_BASE_DIRS }
