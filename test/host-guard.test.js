const test = require('node:test')
const assert = require('node:assert/strict')
const { hostnameOf, parseAllowedHosts, isAllowedHost, hostGuard } = require('../services/host-guard')

// DNS リバインディングでは Host が攻撃者のドメイン名になる。IP・localhost・許可した名前以外は拒否する。

test('Host から名前部分を取り出す（ポート・IPv6 括弧・大文字・末尾ドット）', () => {
  assert.equal(hostnameOf('192.0.2.10:8080'), '192.0.2.10')
  assert.equal(hostnameOf('[::1]:3333'), '::1')
  assert.equal(hostnameOf('Pocket.Example.COM.'), 'pocket.example.com')
  assert.equal(hostnameOf('localhost'), 'localhost')
})

test('IP リテラルと localhost は設定なしで通す', () => {
  for (const h of ['127.0.0.1:8080', '198.51.100.5', '[::1]:8080', '[2001:db8::1]', 'localhost:8080', 'app.localhost']) {
    assert.equal(isAllowedHost(h, []), true, h)
  }
})

test('許可していないドメイン名は拒否する（リバインディングの経路）', () => {
  assert.equal(isAllowedHost('attacker.example:8080', []), false)
  assert.equal(isAllowedHost('localhost.attacker.example', []), false)
  assert.equal(isAllowedHost('127.0.0.1.nip.io', []), false)
})

test('許可リスト: 完全一致と先頭ドットのサブドメイン指定', () => {
  const allowed = parseAllowedHosts(undefined, ['pocket.example.com', '.home.arpa'])
  assert.equal(isAllowedHost('pocket.example.com', allowed), true)
  assert.equal(isAllowedHost('POCKET.example.com:443', allowed), true)
  assert.equal(isAllowedHost('evil.pocket.example.com', allowed), false)
  assert.equal(isAllowedHost('home.arpa', allowed), true)
  assert.equal(isAllowedHost('nas.home.arpa', allowed), true)
  assert.equal(isAllowedHost('nothome.arpa', allowed), false)
})

test('環境変数 ALLOWED_HOSTS が config より優先される', () => {
  assert.deepEqual(parseAllowedHosts(' a.example , b.example ', ['c.example']), ['a.example', 'b.example'])
  assert.deepEqual(parseAllowedHosts('', ['c.example']), ['c.example'])
  assert.deepEqual(parseAllowedHosts(undefined, 'not-an-array'), [])
})

test('Host ヘッダーが無いリクエストは通す（ブラウザは必ず付ける）', () => {
  assert.equal(isAllowedHost(undefined, []), true)
})

test('ミドルウェア: 拒否は 403 で設定方法を案内し、許可は next', () => {
  const mw = hostGuard(['pocket.example.com'])
  let nextCalled = false
  mw({ headers: { host: 'pocket.example.com' } }, {}, () => { nextCalled = true })
  assert.equal(nextCalled, true)

  const res = {
    statusCode: 0, body: '',
    status(c) { this.statusCode = c; return this },
    type() { return this },
    send(b) { this.body = b; return this },
  }
  const origWarn = console.warn
  console.warn = () => {}
  try {
    mw({ headers: { host: 'attacker.example:8080' } }, res, () => { throw new Error('must not pass') })
  } finally {
    console.warn = origWarn
  }
  assert.equal(res.statusCode, 403)
  assert.match(res.body, /allowedHosts/)
})
