// 修复提示词 facts（DSR-018/R-17/AC-15）：稳定 code 全量登记 repair 模板、
// buildRepair 组装形状、dispatch 端到端携带（operation=端点名、动态 facts
// 不被吞）。Client 统一模板（P6）消费此形状。

import test from 'node:test'
import assert from 'node:assert/strict'
import { REPAIR_META, SkillManagerError, buildRepair } from '../src/core/base/errors.js'
import { createDispatch } from '../src/core/service.js'

// 与源码 `new SkillManagerError('code'…)` 及 net.js GhError kind 同步维护的
// 稳定码全集（漏登 = 本测试红）。
const STABLE_CODES = [
  'skilldir-unconfigured', 'skilldir-missing', 'workspace-unavailable',
  'bad-name', 'bad-path', 'bad-repo', 'bad-group-name', 'bad-zipball',
  'name-conflict', 'needs-selection', 'no-skill-md', 'not-found',
  'not-removable', 'already-installed', 'path-stale', 'remote-unreachable',
  'target-occupied', 'wrong-target', 'write-failed',
  'local-changes-confirmation-required',
  'not_found', 'http_error', 'rate_limited', 'unreachable',
  'unknown-endpoint',
]

test('REPAIR_META：全部稳定码登记在案且模板齐形', () => {
  for (const code of STABLE_CODES) {
    const meta = REPAIR_META[code]
    assert.ok(meta, `稳定码 ${code} 缺 repair 模板`)
    assert.ok(typeof meta.summary === 'string' && meta.summary.length > 8, `${code} summary 无效`)
    assert.ok(Array.isArray(meta.recommendation) && meta.recommendation.length > 0, `${code} recommendation 缺失`)
    assert.ok(meta.recommendation.every((s) => typeof s === 'string' && s !== ''), `${code} recommendation 含空串`)
  }
})

test('buildRepair：模板+动态 facts 合并；表外/未分类落通用模板；空值 fact 过滤', () => {
  const r = buildRepair('target-occupied', {
    operation: 'sync',
    facts: [{ label: '目标路径', value: 'C:\\ws\\.dsh\\skills\\pdf' }, { label: '空值项', value: '' }],
  })
  assert.equal(r.operation, 'sync')
  assert.match(r.summary, /占用/)
  assert.equal(r.facts.length, 1) // 空 value 被过滤
  assert.deepEqual(Object.keys(r).sort(), ['facts', 'operation', 'recommendation', 'summary'])
  const generic = buildRepair('internal', {})
  assert.match(generic.summary, /未分类/)
  assert.ok(generic.recommendation.length >= 2)
  assert.equal(buildRepair('internal').operation, 'internal') // operation 缺省回退 code
})

test('dispatch 端到端：SkillManagerError 的 facts 与端点名进入 repair', async () => {
  const dispatch = createDispatch({
    async sync() {
      throw new SkillManagerError('target-occupied', '占用', false, [{ label: '目标路径', value: 'D:\\x\\pdf' }])
    },
  })
  const result = await dispatch('sync', {})
  assert.equal(result.ok, false)
  assert.equal(result.error.details.repair.operation, 'sync')
  assert.deepEqual(result.error.details.repair.facts, [{ label: '目标路径', value: 'D:\\x\\pdf' }])
  // 未知端点同样携带 repair（任何失败都有复制入口）
  const ghost = await dispatch('ghost', {})
  assert.equal(ghost.error.details.retryable, false)
  assert.ok(ghost.error.details.repair.recommendation.length > 0)
})
