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

// spawn引数に載せるツール構成を決める(allowlist方式)。
// - AskUserQuestion は常に無効(ヘッドレスモードでは対話的に解決できないため)。allowlist側に
//   紛れ込んでいた場合も除去する(利用者が誤って一覧へ足しても事故らないための保険)。
// - どちらの設定キー(toolsDirect/toolsProxy)も未設定(null/undefined)なら絞らない＝tools:null
//   (--toolsを渡さない＝全ツール)。
// - 見るキーは proxyEnv の有無で決める: プロキシ経由セッションは toolsProxy、
//   Claude直セッションは toolsDirect。
// - 空配列([])は「全ツール無効」という利用者の明示的な意思として尊重し、そのまま返す
//   (CLI側で --tools "" として渡せば全ツール無効になる)。
function getToolFlags(config, proxyEnv) {
  const disallowedTools = ['AskUserQuestion']
  const raw = proxyEnv ? config.toolsProxy : config.toolsDirect
  if (!Array.isArray(raw)) {
    return { tools: null, disallowedTools }
  }
  const tools = raw.filter(t => t !== 'AskUserQuestion')
  return { tools, disallowedTools }
}

module.exports = { getProxyEnv, proxyRouteChanged, getToolFlags }
