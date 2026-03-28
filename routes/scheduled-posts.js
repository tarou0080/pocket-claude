const express = require('express')
const router = express.Router()
const {
  createPost,
  updatePost,
  deletePost,
  getPost,
  getAllPosts,
  getPostsBySession
} = require('../services/scheduled-posts')

// 予約投稿作成
router.post('/', (req, res) => {
  const { scheduledAt, prompt, sessionId, project, model, effort, thinking } = req.body
  if (!scheduledAt || !prompt || !sessionId) {
    return res.status(400).json({ error: 'scheduledAt, prompt, sessionId are required' })
  }
  const id = createPost({ scheduledAt, prompt, sessionId, project, model, effort, thinking })
  res.json({ id })
})

// 全予約投稿取得
router.get('/', (req, res) => {
  res.json(getAllPosts())
})

// 特定セッションの予約投稿取得
router.get('/session/:sessionId', (req, res) => {
  res.json(getPostsBySession(req.params.sessionId))
})

// 特定予約投稿取得
router.get('/:id', (req, res) => {
  const post = getPost(req.params.id)
  if (!post) return res.status(404).json({ error: 'Not found' })
  res.json(post)
})

// 予約投稿更新
router.patch('/:id', (req, res) => {
  const { scheduledAt, prompt } = req.body
  if (!scheduledAt || !prompt) {
    return res.status(400).json({ error: 'scheduledAt and prompt are required' })
  }
  const success = updatePost(req.params.id, { scheduledAt, prompt })
  if (!success) return res.status(404).json({ error: 'Not found' })
  res.json({ success: true })
})

// 予約投稿削除
router.delete('/:id', (req, res) => {
  const success = deletePost(req.params.id)
  if (!success) return res.status(404).json({ error: 'Not found' })
  res.json({ success: true })
})

module.exports = router
