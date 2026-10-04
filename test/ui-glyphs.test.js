const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

// 画面の目印は線画アイコン（index.html の ICONS）で描く。カラー絵文字は行の文字色が効かず、
// iPhone では文字表示が既定の記号（⚠ ⏱ など）まで色付きで描かれて浮くため使わない。
const root = path.join(__dirname, '..')
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8')
const serverFiles = ['server.js', ...['services', 'routes'].flatMap(d =>
  fs.readdirSync(path.join(root, d)).filter(f => f.endsWith('.js')).map(f => `${d}/${f}`))]

// 送信ボタンの ✨ はボタンの意匠で、会話の行ではない。
const ALLOWED = new Set(['✨'])

test('画面とサーバーの文言にカラー絵文字が無い', () => {
  for (const [name, src] of [['public/index.html', html],
    ...serverFiles.map(f => [f, fs.readFileSync(path.join(root, f), 'utf8')])]) {
    const found = [...src.matchAll(/\p{Extended_Pictographic}/gu)].map(m => m[0]).filter(c => !ALLOWED.has(c))
    assert.deepEqual(found, [], `${name} に絵文字: ${found.join(' ')}（ICONS の線画アイコンを使う）`)
  }
})

test('サーバーが送る system 行の key は画面に見た目と ja/en の訳がある', () => {
  const keys = new Set()
  for (const f of serverFiles) {
    const src = fs.readFileSync(path.join(root, f), 'utf8')
    for (const m of src.matchAll(/type: 'system', key: '(\w+)'/g)) keys.add(m[1])
  }
  assert.ok(keys.size > 0)
  const block = name => html.match(new RegExp(`\\n  ${name}: \\{([\\s\\S]*?)\\n  \\},`))[1]
  const lines = html.match(/const SYSTEM_LINES = \{([\s\S]*?)\n\}/)[1]
  for (const k of keys) {
    for (const lang of ['ja', 'en']) assert.match(block(lang), new RegExp(`\\n    ${k}:`), `STRINGS.${lang}.${k} が無い`)
    assert.match(lines, new RegExp(`\\n  ${k}:`), `SYSTEM_LINES.${k} が無い`)
  }
})
