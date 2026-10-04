const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

// 画面の目印は線画アイコン（index.html の ICONS）で描き、文言はすべて辞書（STRINGS・t()）を通す。
// カラー絵文字は行の文字色が効かず、iPhone では文字表示が既定の記号（⚠ ⏱ など）まで色付きで描かれて浮く。
// 直書きの文言は言語設定に従わず、英語の利用者に日本語が出る（その逆も）。
const root = path.join(__dirname, '..')
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8')
const serverFiles = ['server.js', ...['services', 'routes'].flatMap(d =>
  fs.readdirSync(path.join(root, d)).filter(f => f.endsWith('.js')).map(f => `${d}/${f}`))]
const read = f => fs.readFileSync(path.join(root, f), 'utf8')

const JP = /[぀-ヿ一-鿿]/
const block = name => html.match(new RegExp(`\\n  ${name}: \\{([\\s\\S]*?)\\n  \\},`))[1]
const keysOf = src => new Set([...src.matchAll(/\n {4}(\w+):/g)].map(m => m[1]))
const cliTerms = new Set([...html.match(/const CLI_TERMS = \{([\s\S]*?)\n\}/)[1].matchAll(/\n {2}(\w+):/g)].map(m => m[1]))
const dict = { ja: new Set([...keysOf(block('ja')), ...cliTerms]), en: new Set([...keysOf(block('en')), ...cliTerms]) }

// コメントを除いた文字列リテラル（'…' "…" `…`）
function literals(code) {
  const out = []
  for (const line of code.split('\n')) {
    const body = line.replace(/^\s*(\/\/|\*|\/\*).*$/, '').replace(/\s\/\/\s.*$/, '')
    for (const m of body.matchAll(/'[^']*'|"[^"]*"|`[^`]*`/g)) out.push(m[0])
  }
  return out
}

// 送信ボタンの ✨ はボタンの意匠で、会話の行ではない。
const ALLOWED_GLYPHS = new Set(['✨'])

test('画面とサーバーの文言にカラー絵文字が無い', () => {
  for (const [name, src] of [['public/index.html', html], ...serverFiles.map(f => [f, read(f)])]) {
    const found = [...src.matchAll(/\p{Extended_Pictographic}/gu)].map(m => m[0]).filter(c => !ALLOWED_GLYPHS.has(c))
    assert.deepEqual(found, [], `${name} に絵文字: ${found.join(' ')}（ICONS の線画アイコンを使う）`)
  }
})

test('スクリプトの日本語は辞書の中にだけある', () => {
  const script = html.slice(html.indexOf('<script>'))
  const dictStart = script.indexOf('const CLI_TERMS')
  const dictEnd = script.indexOf('\n}\n', script.indexOf('const STRINGS'))
  const outside = script.slice(0, dictStart) + script.slice(dictEnd)
  const found = literals(outside).filter(s => JP.test(s))
  assert.deepEqual(found, [], '辞書（STRINGS）へ移して t() で引く')
})

test('静的な HTML の文言は data-i18n で辞書から入れる', () => {
  const body = html.slice(html.indexOf('<body'), html.indexOf('<script>', html.indexOf('<body')))
  // 言語ボタンの自称（日本語 / English）と、JS が書き換える数値表示だけは直書き
  const ALLOWED_TEXT = new Set(['日本語', 'English'])
  const texts = [...body.matchAll(/>([^<>]+)</g)].map(m => m[1].trim())
    .filter(s => /[A-Za-z぀-鿿]/.test(s) && !ALLOWED_TEXT.has(s) && !/^\d+px$/.test(s) && !/^&#\w+;/.test(s))
  assert.deepEqual(texts, [])
  assert.deepEqual([...body.matchAll(/\s(title|placeholder|aria-label)="/g)].map(m => m[1]), [],
    'data-i18n-title / data-i18n-aria / updatePlaceholder を使う')
})

test('辞書は ja と en で同じキーを持ち、使われるキーはすべてある', () => {
  assert.deepEqual([...dict.ja].filter(k => !dict.en.has(k)), [], 'en に無いキー')
  assert.deepEqual([...dict.en].filter(k => !dict.ja.has(k)), [], 'ja に無いキー')
  const used = new Set([
    ...[...html.matchAll(/\bt\('(\w+)'/g)].map(m => m[1]),
    ...[...html.matchAll(/data-i18n(?:-title|-aria)?="(\w+)"/g)].map(m => m[1]),
  ])
  assert.deepEqual([...used].filter(k => !dict.ja.has(k)), [])
})

test('サーバーの文言は英語の代替＋key で送り、訳は画面の辞書が持つ', () => {
  const lines = html.match(/const SYSTEM_LINES = \{([\s\S]*?)\n\}/)[1]
  const keys = new Set()
  const reasonKeys = new Set()
  for (const f of serverFiles) {
    const src = read(f)
    for (const m of src.matchAll(/type: 'system', key: '(\w+)'/g)) keys.add(m[1])
    for (const m of src.matchAll(/(?:reasonKey|failedReasonKey): '(\w+)'|reasonKey = [^\n]*'(\w+)'|, '(reason\w+)'\)/g)) reasonKeys.add(m[1] || m[2] || m[3])
    // 日本語を書いてよいのは Claude 宛ての本文（印のコメント付きの行）だけ
    const jp = src.split('\n').filter(l => !/Claude 宛ての本文/.test(l)).flatMap(l => literals(l)).filter(s => JP.test(s))
    assert.deepEqual(jp, [], `${f} の日本語の文言`)
  }
  assert.ok(keys.size > 0 && reasonKeys.size > 0)
  for (const k of [...keys, ...reasonKeys]) {
    assert.ok(dict.ja.has(k) && dict.en.has(k), `STRINGS に ${k} が無い`)
  }
  for (const k of keys) assert.match(lines, new RegExp(`\\n  ${k}:`), `SYSTEM_LINES.${k} が無い`)
})
