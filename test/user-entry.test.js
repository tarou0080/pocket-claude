const test = require('node:test')
const assert = require('node:assert/strict')
const { titleCandidate } = require('../services/user-entry')

// 履歴一覧のタイトルは CLI の会話一覧と同じ規則で選ぶ（発言でない行・<タグ で始まる行を飛ばし、
// スラッシュコマンドは他に無いときの控え）。

const user = (content, extra = {}) => ({ type: 'user', message: { content }, ...extra })

test('titleCandidate: CLI が一覧に出さない行は候補にしない', () => {
  assert.equal(titleCandidate(user('<local-command-caveat>Caveat: ...</local-command-caveat>', { isMeta: true })), null)
  assert.equal(titleCandidate(user('summary', { isCompactSummary: true })), null)
  assert.equal(titleCandidate(user([{ type: 'text', text: '[Request interrupted by user]' }])), null)
  assert.equal(titleCandidate(user('<local-command-stdout>Set model</local-command-stdout>')), null)
  assert.equal(titleCandidate(user('<task-notification><summary>x</summary></task-notification>')), null)
  assert.equal(titleCandidate(user([{ type: 'tool_result', tool_use_id: 't', content: 'x' }])), null)
  assert.equal(titleCandidate({ type: 'assistant', message: { content: [] } }), null)
})

test('titleCandidate: 発言はタイトル、スラッシュコマンドは控え', () => {
  assert.deepEqual(titleCandidate(user('直してほしい\n詳しくは')), { title: '直してほしい 詳しくは' })
  assert.deepEqual(titleCandidate(user([{ type: 'text', text: '画像を見て' }, { type: 'image', source: {} }])), { title: '画像を見て' })
  assert.deepEqual(titleCandidate(user('<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args>opus</command-args>')), { fallback: '/model opus' })
})
