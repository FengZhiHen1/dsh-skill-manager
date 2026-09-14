// 写后裁定（core/model/intent.js 的 writeVerdict）：判据是 Host 权威值，不是浏览器镜像快照。
//
// 背景（2026-09-14 现场实证）：DSH settings-scope 只把"最新一笔写"的回执折进镜像，被后续写
// 超越的那一笔不回折视图；删组/改名一次操作连发 groups+skills 两笔写，第一笔因此必然读到落后
// 快照——按镜像裁定会把已经落盘的写误报成「被拒绝，已恢复原值」，还会把人引向"组名非法"。
// 本文件锁死裁定语义（含键序、数组序、读不到权威值三态），防止回归到"拿镜像比对"。

import test from 'node:test'
import assert from 'node:assert/strict'
import { writeVerdict } from '../src/core/model/verdict.js'

test('writeVerdict：权威值与尝试值等值 → accepted', () => {
  const next = {
    默认: { mounts: [] },
    A: { mounts: [{ scope: 'project', project: 'p1', hosts: ['dsh'] }] },
  }
  assert.equal(writeVerdict(next, structuredClone(next)), 'accepted')
})

test('writeVerdict：键序不同不改判（写值键序不受插件控制，裸 JSON.stringify 会误判未生效）', () => {
  assert.equal(writeVerdict({ a: 1, b: { y: 2, x: 3 } }, { b: { x: 3, y: 2 }, a: 1 }), 'accepted')
})

test('writeVerdict：数组保序，元素换序即 not-applied', () => {
  assert.equal(writeVerdict({ hosts: ['dsh', 'pi'] }, { hosts: ['pi', 'dsh'] }), 'not-applied')
})

test('writeVerdict：权威值仍是旧值 → not-applied（真被拒或已被并发写覆盖）', () => {
  const before = { 默认: { mounts: [] }, 学习: { mounts: [] } }
  const next = { 默认: { mounts: [] } }
  assert.equal(writeVerdict(next, before), 'not-applied')
})

test('writeVerdict：读不到权威值 → unknown（不猜"被拒"）', () => {
  assert.equal(writeVerdict({ 默认: { mounts: [] } }, undefined), 'unknown')
})

test('writeVerdict：null 与 undefined 的规范化取值不误伤比对', () => {
  assert.equal(writeVerdict([], []), 'accepted')
  assert.equal(writeVerdict(0, 0), 'accepted')
  assert.equal(writeVerdict(false, false), 'accepted')
  assert.equal(writeVerdict('', ''), 'accepted')
})
