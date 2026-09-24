const { test } = require('node:test')
const assert = require('node:assert')
const { validAutoCompactWindow } = require('../services/auto-compact')

test('validAutoCompactWindow: 正の整数だけを通し、それ以外は null（=CLI既定）', () => {
  assert.strictEqual(validAutoCompactWindow(300000), 300000)
  assert.strictEqual(validAutoCompactWindow(1), 1)
  for (const v of [undefined, null, 0, -1, 1.5, '300000', NaN, Infinity, {}]) {
    assert.strictEqual(validAutoCompactWindow(v), null, String(v))
  }
})
