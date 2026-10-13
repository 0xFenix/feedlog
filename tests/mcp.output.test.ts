import assert from 'node:assert/strict'
import { test } from 'node:test'
import { toolRecord, writeResult } from '../server/mcp/output'

test('MCP output uses UTC dates and absolute media URLs without rewriting arbitrary metadata', () => {
  const result = toolRecord({
    createdAt: new Date('2026-01-01T08:00:00-07:00'),
    author: { image: '/api/files/avatar.png' },
    cover: 'https://cdn.example.com/cover.png',
    metadata: { editorSettings: { fontSize: 14 } },
    items: [{ postId: 'feedback-id', type: 'mergedPost', metadata: { merged_post_id: 'child-id' } }],
  }, 'https://portal.example.com')
  assert.deepEqual(result, {
    created_at: '2026-01-01T15:00:00.000Z',
    author: { image: 'https://portal.example.com/api/files/avatar.png' },
    cover: 'https://cdn.example.com/cover.png',
    metadata: { editorSettings: { fontSize: 14 } },
    items: [{ feedback_id: 'feedback-id', type: 'feedback_merged', metadata: { merged_feedback_id: 'child-id' } }],
  })
})

test('new database fields do not automatically become MCP write result fields', () => {
  assert.deepEqual(writeResult({ id: 'article-id', content: 'Long body', tsv: 'Search index', futurePrivateField: 'private', warnings: [{ code: 'HELP_CENTER_DISABLED' }] }, 'help_article'), {
    id: 'article-id', warnings: [{ code: 'HELP_CENTER_DISABLED' }],
  })
  assert.deepEqual(toolRecord({ metadata: 'Free-form value' }), { metadata: 'Free-form value' })
})
