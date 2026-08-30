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

module.exports = { getProxyEnv, proxyRouteChanged }
