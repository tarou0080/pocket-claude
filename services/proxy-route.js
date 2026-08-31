// config.proxyModels の参照方法を一箇所に集約する。
// services/spawner.js の startClaude が子プロセスのenvへ注入するときの引き方
// （config.proxyModels && config.proxyModels[model]）と、
// routes/claude.js がモデル切替の再起動要否を判定するときの引き方を必ず一致させるため、
// どちらもここを通す。

function getProxyEnv(config, model) {
  return (config.proxyModels && config.proxyModels[model]) || null
}

// 2つのモデルが同じプロキシ経路（envの注入内容）を共有するかどうか。
// 異なる場合はプロセスのenvが固定されているため、set_modelでCLI内部のモデル名だけ
// 変えても実際の接続先(ANTHROPIC_BASE_URL等)は古いままになる＝再起動が必要。
function proxyRouteChanged(config, oldModel, newModel) {
  return JSON.stringify(getProxyEnv(config, oldModel)) !== JSON.stringify(getProxyEnv(config, newModel))
}

// プロキシ経由モデル向けの推奨削減リスト。翻訳プロキシ配下の小型ローカルモデル等、
// プロンプトキャッシュが効かない経路でのみ効果がある（ツール定義の再送コストが下がる）。
// あくまで config.json の `proxyDisallowedTools` にコピーして使う「値」として存在し、
// ここでは自動適用しない（下のgetDisallowedTools参照）。
const PROXY_DISALLOWED_DEFAULT = [
  'Agent', 'CronCreate', 'CronDelete', 'CronList', 'DesignSync',
  'EnterWorktree', 'ExitWorktree', 'ListAgents', 'Monitor', 'NotebookEdit',
  'PushNotification', 'ReportFindings', 'ScheduleWakeup', 'SendMessage',
  'Skill', 'TaskCreate', 'TaskGet', 'TaskList', 'TaskOutput', 'TaskStop',
  'TaskUpdate', 'WebSearch', 'Workflow',
]

// spawn引数へ渡す --disallowed-tools の中身を決める。
// AskUserQuestion は常に落とす(ヘッドレスモードでは応答できないため)。
// 周辺ツールの削減は config.proxyDisallowedTools を設定した場合のみ行うオプトイン。
// 理由: 公開利用者の中には社内ゲートウェイ等でプロンプトキャッシュが効く「本物のClaude」を
// プロキシ経由で使うケースがあり、その場合は削減が不要かつ有害（キャッシュに乗るツール定義を
// 使えるツールごと失うだけ）。削減が効くのはキャッシュの効かない小型ローカルモデル等で、
// それは利用者自身が proxyDisallowedTools を設定して選ぶ。何も設定していない利用者の
// ツールが黙って23個消えることは避ける。
function getDisallowedTools(config, proxyEnv) {
  const disallowedTools = ['AskUserQuestion']
  if (proxyEnv && config.proxyDisallowedTools) {
    disallowedTools.push(...config.proxyDisallowedTools)
  }
  return disallowedTools
}

module.exports = { getProxyEnv, proxyRouteChanged, getDisallowedTools, PROXY_DISALLOWED_DEFAULT }
