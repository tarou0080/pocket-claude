// Host ヘッダーの許可リスト（v3.0.0）。DNS リバインディング対策。
// 悪意あるページが自分のドメインの向き先を pocket-claude の IP へ切り替えると、ブラウザは
// そのページと API を同一オリジンとみなし、無認証の API（/api/send＝claude の実行）を叩けてしまう。
// このときリクエストの Host は攻撃者のドメイン名になる。名前が IP リテラル・localhost・
// 利用者が許可した名前のどれでもなければ拒否する（Vite の server.allowedHosts と同じ型）。
// Origin の照合では防げない（リバインディング後は Origin も Host も攻撃者のドメインで一致する）。
const net = require('net')

// Host ヘッダーから名前部分を取り出す（ポートを落とし、小文字化・末尾のドットを除く）。
function hostnameOf(hostHeader) {
  const h = String(hostHeader).trim().toLowerCase()
  let name
  if (h.startsWith('[')) {
    const end = h.indexOf(']')
    name = end === -1 ? h : h.slice(1, end)
  } else {
    const colon = h.lastIndexOf(':')
    name = colon === -1 ? h : h.slice(0, colon)
  }
  return name.replace(/\.$/, '')
}

// 許可リストの正規化。config.allowedHosts（配列）または環境変数 ALLOWED_HOSTS（カンマ区切り）。
// 環境変数が設定されていればそちらを使う（HOST / config.host と同じ優先順）。
// 先頭が "." の項目はそのドメインとサブドメインすべて（".example.com" → example.com と *.example.com）。
function parseAllowedHosts(envValue, configValue) {
  let list = []
  if (typeof envValue === 'string' && envValue.trim() !== '') list = envValue.split(',')
  else if (Array.isArray(configValue)) list = configValue
  return list
    .filter(v => typeof v === 'string')
    .map(v => v.trim().toLowerCase().replace(/\.$/, ''))
    .filter(Boolean)
}

function isAllowedHost(hostHeader, allowedHosts) {
  // Host が無いリクエストはブラウザからは来ない（ブラウザは必ず付ける）＝リバインディングの経路ではない
  if (hostHeader === undefined || hostHeader === '') return true
  const name = hostnameOf(hostHeader)
  if (net.isIP(name)) return true
  // localhost と *.localhost はブラウザが DNS を引かずにループバックへ向ける＝向き先を差し替えられない
  if (name === 'localhost' || name.endsWith('.localhost')) return true
  return allowedHosts.some(a => a.startsWith('.')
    ? (name === a.slice(1) || name.endsWith(a))
    : name === a)
}

function hostGuard(allowedHosts) {
  const warned = new Set()
  return (req, res, next) => {
    const host = req.headers.host
    if (isAllowedHost(host, allowedHosts)) return next()
    const name = hostnameOf(host)
    if (!warned.has(name)) {
      warned.add(name)
      console.warn(`[host-guard] Blocked request for host "${name}". If this is your own address, add it to "allowedHosts" in config.json (or ALLOWED_HOSTS).`)
    }
    res.status(403).type('text/plain').send(
      `Blocked request: host "${name}" is not allowed.\n` +
      `If you reach pocket-claude through this name, add it to "allowedHosts" in config.json ` +
      `(or the ALLOWED_HOSTS environment variable, comma-separated) and restart the server.\n`
    )
  }
}

module.exports = { hostnameOf, parseAllowedHosts, isAllowedHost, hostGuard }
