// 修复提示词 facts（DSR-018/R-17/AC-15）：稳定 code 全量登记 repair 模板、
// buildRepair 组装形状、dispatch 端到端携带（operation=端点名、动态 facts
// 不被吞）。Client 统一模板消费此形状。
//
// 码表维护是机械交叉而非手抄清单：从 src 源码提取全部抛出码
// （new SkillManagerError / new GhError / buildRepair 字面量），与
// REPAIR_META 键做双向集合相等——漏登或表外抛码两边都红。

import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { REPAIR_META, SkillManagerError, buildRepair } from '../src/core/base/errors.js'
import { createDispatch } from '../src/core/service.js'

const SRC_CORE = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'core')

/** 递归收集 src/core 下全部 .js 文件。 */
async function collectJs(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await collectJs(p))
    else if (entry.name.endsWith('.js')) out.push(p)
  }
  return out
}

/** 从源码提取稳定错误码全集（抛出点 + buildRepair 字面量，'internal' 走通用模板不在表内）。 */
async function extractThrownCodes() {
  const codes = new Set()
  for (const file of await collectJs(SRC_CORE)) {
    const text = await readFile(file, 'utf8')
    for (const re of [/new SkillManagerError\(\s*'([^']+)'/g, /new GhError\(\s*'([^']+)'/g, /buildRepair\(\s*'([^']+)'/g]) {
      for (const m of text.matchAll(re)) {
        if (m[1] !== 'internal') codes.add(m[1])
      }
    }
  }
  return codes
}

test('码表机械交叉：抛出码全集与 REPAIR_META 键双向相等（漏登/表外抛码都红）', async () => {
  const thrown = await extractThrownCodes()
  const tabled = new Set(Object.keys(REPAIR_META))
  assert.deepEqual([...tabled].sort(), [...thrown].sort(), 'REPAIR_META 键集与源码抛出码集不一致（双向核对）')
})

test('REPAIR_META：全部模板齐形（summary 一句 + 非空 recommendation）', () => {
  for (const [code, meta] of Object.entries(REPAIR_META)) {
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
