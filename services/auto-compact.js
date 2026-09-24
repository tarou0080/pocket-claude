// 自動圧縮の開始点（CLI 設定 autoCompactWindow・トークン数）の妥当性。
// 正の整数だけを有効とし、それ以外（未設定・null・不正値）は null＝CLI 既定に委ねる。
// 上限はここで決めない: モデルの窓を超える値は CLI が窓へ切り詰める（実測）ため、
// pocket がモデルごとの窓を複製して持つ必要が無い。
function validAutoCompactWindow(v) {
  return Number.isInteger(v) && v > 0 ? v : null
}

module.exports = { validAutoCompactWindow }
