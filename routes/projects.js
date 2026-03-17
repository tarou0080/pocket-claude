const express = require('express')
const fs = require('fs')
const path = require('path')
const router = express.Router()

const PROJECTS_FILE = path.join(__dirname, '..', 'projects.json')

// プロジェクト一覧取得（パス付き）
router.get('/list', (_req, res) => {
  try {
    const projects = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8'))
    res.json(projects)
  } catch {
    const homeDir = process.env.HOME || path.join('/home', process.env.USER || 'user')
    res.json({ home: homeDir })
  }
})

// プロジェクト追加
router.post('/add', (req, res) => {
  const { name, path: projectPath } = req.body

  // バリデーション
  if (!name || !projectPath) {
    return res.status(400).json({ error: 'Name and path are required' })
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    return res.status(400).json({ error: 'Invalid name. Use only alphanumeric, underscore, and hyphen.' })
  }

  try {
    // パス解決と存在チェック
    const resolved = path.resolve(projectPath)
    fs.accessSync(resolved, fs.constants.R_OK)
    const realPath = fs.realpathSync(resolved)

    // projects.json 読み込み
    let projects
    try {
      projects = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8'))
    } catch {
      projects = {}
    }

    // 重複チェック
    if (projects[name]) {
      return res.status(409).json({ error: `Project "${name}" already exists` })
    }

    // 追加して保存
    projects[name] = realPath
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2))

    // メモリ上の config.projects も更新
    const config = require('../config/index')
    config.projects[name] = realPath

    res.json({ ok: true, name, path: realPath })
  } catch (err) {
    if (err.code === 'ENOENT') {
      res.status(400).json({ error: `Path does not exist: ${projectPath}` })
    } else if (err.code === 'EACCES') {
      res.status(400).json({ error: `Permission denied: ${projectPath}` })
    } else {
      res.status(400).json({ error: `Invalid path: ${err.message}` })
    }
  }
})

// プロジェクト削除
router.post('/remove', (req, res) => {
  const { name } = req.body

  if (!name) {
    return res.status(400).json({ error: 'Name is required' })
  }

  try {
    let projects
    try {
      projects = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8'))
    } catch {
      return res.status(404).json({ error: 'No projects found' })
    }

    if (!projects[name]) {
      return res.status(404).json({ error: `Project "${name}" not found` })
    }

    delete projects[name]
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2))

    // メモリ上の config.projects も更新
    const config = require('../config/index')
    delete config.projects[name]

    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
