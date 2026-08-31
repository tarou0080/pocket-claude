const express = require('express')
const fs = require('fs')
const path = require('path')
const router = express.Router()
const { writeJsonAtomic } = require('../services/persist')
const { loadToolsCatalog } = require('../services/tools-catalog')

const CONFIG_FILE = path.join(__dirname, '..', 'config.json')

function readConfigFile() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
  } catch {
    return {}
  }
}

// null か「文字列だけの配列」のみ受理(toolsDirect/toolsProxy共通)。
function isValidToolsValue(v) {
  return v === null || (Array.isArray(v) && v.every(t => typeof t === 'string'))
}

// GET /api/server-config — 公開可能な設定値を返す
router.get('/', (_req, res) => {
  const cfg = readConfigFile()
  res.json({
    maxBodySizeMb: typeof cfg.maxBodySizeMb === 'number' ? cfg.maxBodySizeMb : 0,
    resumeDefaultOn: typeof cfg.resumeDefaultOn === 'boolean' ? cfg.resumeDefaultOn : false,
    toolsDirect: Array.isArray(cfg.toolsDirect) ? cfg.toolsDirect : null,
    toolsProxy: Array.isArray(cfg.toolsProxy) ? cfg.toolsProxy : null,
    toolCatalog: loadToolsCatalog(),
    hasProxyModels: !!(cfg.proxyModels && Object.keys(cfg.proxyModels).length > 0),
  })
})

// PATCH /api/server-config — 設定値を更新
router.patch('/', (req, res) => {
  const { maxBodySizeMb, resumeDefaultOn, toolsDirect, toolsProxy } = req.body
  if (maxBodySizeMb !== undefined) {
    if (typeof maxBodySizeMb !== 'number' || maxBodySizeMb < 0 || !Number.isFinite(maxBodySizeMb)) {
      return res.status(400).json({ error: 'maxBodySizeMb must be a non-negative number (0 = unlimited)' })
    }
  }
  if (resumeDefaultOn !== undefined) {
    if (typeof resumeDefaultOn !== 'boolean') {
      return res.status(400).json({ error: 'resumeDefaultOn must be a boolean' })
    }
  }
  if (toolsDirect !== undefined && !isValidToolsValue(toolsDirect)) {
    return res.status(400).json({ error: 'toolsDirect must be null or an array of strings' })
  }
  if (toolsProxy !== undefined && !isValidToolsValue(toolsProxy)) {
    return res.status(400).json({ error: 'toolsProxy must be null or an array of strings' })
  }

  const cfg = readConfigFile()
  if (maxBodySizeMb !== undefined) cfg.maxBodySizeMb = maxBodySizeMb
  if (resumeDefaultOn !== undefined) cfg.resumeDefaultOn = resumeDefaultOn
  if (toolsDirect !== undefined) {
    if (toolsDirect === null) delete cfg.toolsDirect
    else cfg.toolsDirect = toolsDirect
  }
  if (toolsProxy !== undefined) {
    if (toolsProxy === null) delete cfg.toolsProxy
    else cfg.toolsProxy = toolsProxy
  }

  const ok = writeJsonAtomic(CONFIG_FILE, cfg, { pretty: true })
  if (!ok) {
    return res.status(500).json({ error: 'failed to save config' })
  }
  // メモリ上のconfigも更新（再起動不要。次に起動するセッションから反映される）
  const config = require('../config/index')
  if (maxBodySizeMb !== undefined) config.maxBodySizeMb = maxBodySizeMb
  if (resumeDefaultOn !== undefined) config.resumeDefaultOn = resumeDefaultOn
  if (toolsDirect !== undefined) config.toolsDirect = cfg.toolsDirect ?? null
  if (toolsProxy !== undefined) config.toolsProxy = cfg.toolsProxy ?? null
  res.json({
    ok: true,
    maxBodySizeMb: cfg.maxBodySizeMb,
    resumeDefaultOn: cfg.resumeDefaultOn ?? false,
    toolsDirect: cfg.toolsDirect ?? null,
    toolsProxy: cfg.toolsProxy ?? null,
  })
})

module.exports = router
