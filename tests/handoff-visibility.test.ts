import assert from 'node:assert/strict'
import { test } from 'node:test'
import { publicItem } from '../server/lib/agent/runtime'

const handoff = (reason: string) => ({
  id: 'handoff:test', seq: 2, author_type: 'system',
  content: { parts: [{ type: 'system_event', kind: 'handoff', reason, fromStatus: 'ai_handling', toStatus: 'open' }] },
  created_at: '2026-10-21T00:00:00Z',
})

test('Missing-AI handoffs stay hidden when the customer reloads history', () => {
  assert.equal(publicItem(handoff('ai_error')), null)
})

test('requested and rule handoffs keep their existing customer notice', () => {
  for (const reason of ['user_requested', 'support_rule']) {
    assert.equal(publicItem(handoff(reason))?.notice, 'handoff')
  }
})


test('rule handoffs expose only the matching notice category and public text', () => {
  const cases = [
    ['builtin-billing', 'handoffBilling', 'billing'],
    ['builtin-account-access', 'handoffAccount', 'account'],
    ['builtin-privacy-legal', 'handoffPrivacy', 'request'],
    ['custom-rule', 'handoffRule', 'further assistance'],
  ]
  for (const [id, category, text] of cases) {
    const row = handoff('support_rule')
    Object.assign(row.content.parts[0], { rule: { id, scenario: 'Private internal routing instruction' } })
    const item = publicItem(row)
    assert.equal(item?.handoffNotice, category)
    assert.ok(JSON.stringify(item?.content).includes(text))
    assert.ok(!JSON.stringify(item).includes('Private internal routing instruction'))
  }
  assert.equal(publicItem(handoff('support_rule'))?.handoffNotice, 'handoffRule')
  assert.equal(publicItem(handoff('user_requested'))?.handoffNotice, 'handoff')
})
