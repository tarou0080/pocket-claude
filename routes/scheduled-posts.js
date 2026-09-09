const express = require('express')
const router = express.Router()
const {
  createPost,
  updatePost,
  deletePost,
  resendPost,
  getPost,
  getAllPosts,
  getPostsBySession
} = require('../services/scheduled-posts')
const { resolveCanonicalId } = require('../services/sessions')
const { UUID_RE } = require('../services/history')

// 予約投稿作成
router.post('/', (req, res) => {
  const { scheduledAt, prompt, project, model, effort, thinking } = req.body
  let { sessionId } = req.body
  if (!scheduledAt || !prompt || !sessionId) {
    return res.status(400).json({ error: 'scheduledAt, prompt, sessionId are required' })
  }
  if (UUID_RE.test(sessionId)) sessionId = resolveCanonicalId(sessionId)
  const id = createPost({ scheduledAt, prompt, sessionId, project, model, effort, thinking })
  res.json({ id })
})

// 全予約投稿取得
router.get('/', (req, res) => {
  res.json(getAllPosts())
})

// 特定セッションの予約投稿取得
router.get('/session/:sessionId', (req, res) => {
  const sessionId = UUID_RE.test(req.params.sessionId)
    ? resolveCanonicalId(req.params.sessionId)
    : req.params.sessionId
  res.json(getPostsBySession(sessionId))
})

// 特定予約投稿取得
router.get('/:id', (req, res) => {
  const post = getPost(req.params.id)
  if (!post) return res.status(404).json({ error: 'Not found' })
  res.json(post)
})

// 予約投稿更新（failed だった場合は pending へ復帰して再スケジュールする）
router.patch('/:id', (req, res) => {
  const { scheduledAt, prompt } = req.body
  if (!scheduledAt || !prompt) {
    return res.status(400).json({ error: 'scheduledAt and prompt are required' })
  }
  if (new Date(scheduledAt) <= new Date()) {
    return res.status(400).json({ error: 'scheduledAt must be in the future' })
  }
  const success = updatePost(req.params.id, { scheduledAt, prompt })
  if (!success) return res.status(404).json({ error: 'Not found' })
  res.json({ success: true })
})

// 予約投稿の即時再送（executePost と配送・成否処理を共有する）
router.post('/:id/resend', async (req, res) => {
  const existed = getPost(req.params.id)
  if (!existed) return res.status(404).json({ error: 'Not found' })
  await resendPost(req.params.id)
  const after = getPost(req.params.id)
  // after が null = 配送成功して削除された（従来どおり一覧から消える）
  res.json({ success: true, post: after })
})

// 予約投稿削除
router.delete('/:id', (req, res) => {
  const success = deletePost(req.params.id)
  if (!success) return res.status(404).json({ error: 'Not found' })
  res.json({ success: true })
})

module.exports = router
