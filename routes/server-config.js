const express = require('express')
const fs = require('fs')
const path = require('path')
const router = express.Router()

const CONFIG_FILE = path.join(__dirname, '..', 'config.json')

function readConfigFile() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
  } catch {
    return {}
  }
}

// GET /api/server-config — 公開可能な設定値を返す
router.get('/', (_req, res) => {
  const cfg = readConfigFile()
  res.json({
    maxBodySizeMb: typeof cfg.maxBodySizeMb === 'number' ? cfg.maxBodySizeMb : 0,
  })
})

// PATCH /api/server-config — 設定値を更新
router.patch('/', (req, res) => {
  const { maxBodySizeMb } = req.body
  if (maxBodySizeMb !== undefined) {
    if (typeof maxBodySizeMb !== 'number' || maxBodySizeMb < 0 || !Number.isFinite(maxBodySizeMb)) {
      return res.status(400).json({ error: 'maxBodySizeMb must be a non-negative number (0 = unlimited)' })
    }
  }

  const cfg = readConfigFile()
  if (maxBodySizeMb !== undefined) cfg.maxBodySizeMb = maxBodySizeMb

  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2))
    // メモリ上のconfigも更新（再起動不要）
    const config = require('../config/index')
    if (maxBodySizeMb !== undefined) config.maxBodySizeMb = maxBodySizeMb
    res.json({ ok: true, maxBodySizeMb: cfg.maxBodySizeMb })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
