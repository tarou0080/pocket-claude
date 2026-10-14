// Claude Code の会話jsonl（および stdout）の user 行を「画面で何として見せるか」へ分類する。
//
// 表示の正解は CLI 本体の画面（設計の背景「薄いラッパー」: 出力・表示は CLI と同じが正）。
// CLI が画面に出さない行は出さず、CLI が別の形で見せる行はその形にする。判断はここ1か所に
// 置き、会話画面（ライブ・復元）・履歴の詳細・履歴一覧のタイトルの全経路がここを通る
// （経路ごとに規則を持つと直し漏れる＝v2.21.2 で isMeta を1経路だけ直した教訓）。
//
// 見分けられない形は今までどおり発言として出す（形式が変わっても情報を落とさない）。

// CLI がモデル向けに足した行・圧縮の要約。CLI の画面には出ない。
//  - isMeta: スキル本文・画像注記・コマンド前の注意書き（<local-command-caveat>）
//  - isCompactSummary: 圧縮の要約（会話ファイル側の印。画面には compact_boundary の1行が出る）
//  - isSynthetic: stdout 側の要約（同じ行が stdout では isCompactSummary を持たずにこの印で来る）
function isHiddenEntry(entry) {
  return !!(entry && (entry.isMeta || entry.isCompactSummary || entry.isSynthetic))
}

const INTERRUPTED_RE = /^\s*\[Request interrupted by user[^\]]*\]\s*$/
const OUTPUT_RE = /^\s*<(local-command-stdout|local-command-stderr|bash-stdout|bash-stderr)>([\s\S]*?)<\/\1>\s*$/

function tagText(text, name) {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(text)
  return m ? m[1].trim() : null
}

// テキスト1片を分類する。
//  { kind: 'prompt', text, command? } 発言として描く（command=スラッシュコマンド）
//  { kind: 'output', text }            CLI のコマンド出力（system 行）
//  { kind: 'interrupted' }             停止の印（CLI は "Interrupted · …" の1行）
function classifyText(text) {
  if (INTERRUPTED_RE.test(text)) return { kind: 'interrupted' }
  const out = OUTPUT_RE.exec(text)
  if (out) return { kind: 'output', text: out[2].trim() }
  // スラッシュコマンド: CLI は `❯ /model opus` と打った形で見せる
  const name = tagText(text, 'command-name')
  if (name !== null && /^\s*<command-(name|message|args)>/.test(text)) {
    const args = tagText(text, 'command-args')
    return { kind: 'prompt', text: args ? `${name} ${args}` : name, command: true }
  }
  // シェル実行（! cmd）: CLI は `! cmd` と見せる
  const bash = tagText(text, 'bash-input')
  if (bash !== null && /^\s*<bash-input>/.test(text)) return { kind: 'prompt', text: `! ${bash}` }
  return { kind: 'prompt', text }
}

// user 行（または同じ形の queued_command の prompt）を表示の単位へ分ける。
// 戻り値: { items: [classifyText の結果...], images: 画像数, toolResults: [tool_result ブロック] }
// 隠す行は items も images も空で返す（tool_result は会話の事実なので隠さない）。
function viewUserEntry(entry) {
  const view = { items: [], images: 0, toolResults: [] }
  const content = entry && entry.message && entry.message.content
  if (typeof content === 'string') {
    if (!isHiddenEntry(entry) && content.trim()) view.items.push(classifyText(content))
    return view
  }
  if (!Array.isArray(content)) return view
  view.toolResults = content.filter(b => b && b.type === 'tool_result')
  if (isHiddenEntry(entry)) return view
  const joined = content
    .filter(b => b && b.type === 'text' && typeof b.text === 'string')
    .map(b => b.text)
    .join('\n')
  if (joined.trim()) view.items.push(classifyText(joined))
  view.images = content.filter(b => b && b.type === 'image').length
  return view
}

// 履歴一覧のタイトル候補（CLI の会話一覧と同じ規則）。発言でないもの・`<タグ` で始まるもの
// （バックグラウンド通知など）は飛ばす。スラッシュコマンドは他に無いときの控え。
// 戻り値: { title } | { fallback } | null
function titleCandidate(entry) {
  if (!entry || entry.type !== 'user') return null
  const view = viewUserEntry(entry)
  if (view.toolResults.length) return null
  for (const item of view.items) {
    if (item.kind !== 'prompt') continue
    if (item.command) return { fallback: item.text }
    const text = item.text.replace(/\n/g, ' ').trim()
    if (!text || /^<[a-z][\w-]*[\s>]/.test(text)) continue
    return { title: text }
  }
  return null
}

module.exports = { viewUserEntry, titleCandidate, isHiddenEntry }
