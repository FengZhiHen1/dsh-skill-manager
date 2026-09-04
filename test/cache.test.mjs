// 低延迟路径（插件运行时.md「低延迟路径」）：bundle 缓存一致性、overview
// 聚合、meta 缓存复用、哈希门面、队列 busy/idle 语义。

import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createSharedCache, cachedHash, rememberHash, clearHashes, hashOf } from '../src/core/base/cache.js'
import { dirHash, scanLibrary } from '../src/core/model/library.js'
import { buildApi, createQueue } from '../src/core/service.js'
import { mkTmp, cleanup, writeSkill, fakeStore, fakeScope } from './helpers.mjs'

test('createQueue：busy/idle 与失败不阻塞后续', async () => {
  const queue = createQueue()
  assert.equal(queue.busy, false)
  let release
  const gate = new Promise((r) => { release = r })
  const run = queue.enqueue(async () => { await gate })
  assert.equal(queue.busy, true)
  const idle = queue.idle()
  release()
  await run
  await idle
  assert.equal(queue.busy, false)
  const order = []
  await Promise.all([
    queue.enqueue(async () => { order.push('a'); throw new Error('x') }).catch(() => {}),
    queue.enqueue(async () => { order.push('b') }),
  ])
  assert.deepEqual(order, ['a', 'b'])
})

test('scanLibrary：meta 缓存按 stat 签名复用；内容变化后重扫生效', async () => {
  const root = await mkTmp()
  try {
    await writeSkill(root, 'demo', { description: '第一版' })
    const meta = new Map()
    const store = fakeStore()
    const first = await scanLibrary(root, store, { meta })
    assert.equal(first[0].description, '第一版')
    assert.equal(meta.size, 1)
    const again = await scanLibrary(root, store, { meta })
    assert.equal(again[0].description, '第一版')
    assert.equal(meta.size, 1)
    await writeFile(join(root, 'demo', 'SKILL.md'), '---\ndescription: 第二版\n---\n# demo\n', 'utf8')
    const second = await scanLibrary(root, store, { meta })
    assert.equal(second[0].description, '第二版')
  } finally {
    await cleanup(root)
  }
})

test('哈希门面：TTL 命中、fresh 强制重算、clearHashes 清空', async () => {
  const root = await mkTmp()
  try {
    const dir = await writeSkill(root, 'demo')
    const shared = createSharedCache({ hashTtlMs: 60000 })
    const hash = hashOf(shared, dirHash)
    const h1 = await hash(dir)
    assert.equal(await hash(dir), h1) // 缓存命中
    await writeFile(join(dir, 'x.txt'), 'a', 'utf8')
    assert.equal(await hash(dir), h1) // TTL 内仍是旧值（展示性判定可接受）
    const h3 = await hash(dir, { fresh: true })
    assert.notEqual(h3, h1) // fresh 强制重算
    clearHashes(shared)
    assert.equal(await hash(dir), h3) // 清空后重算为当前值
    rememberHash(shared, 'X', 'abc')
    assert.equal(cachedHash(shared, 'X'), 'abc')
    assert.equal(cachedHash(shared, 'Y'), null)
  } finally {
    await cleanup(root)
  }
})

test('bundle 缓存：读命中冻结快照；API 写后刷新立即可见；配置变更冷扫', async () => {
  const root = await mkTmp()
  const groot = await mkTmp()
  try {
    await writeSkill(root, 'pdf')
    const store = fakeStore()
    const api = buildApi(() => fakeScope(root), { getStore: () => store, backupsRoot: '', globalRoot: groot })
    const first = await api.overview({})
    assert.equal(first.lib.skills.length, 1)
    // 缓存热：绕过 API 直改 storage 不立即反映（冻结快照语义，TTL 内一致）
    await store.putSkill('pdf', skillRecordSelf())
    const second = await api.overview({})
    assert.equal(second.lib.skills.length, 1)
    // 文件写操作（sync 写队列）→ refreshCache 预热 → 随后的读立即可见：
    // 绕过 API 直改磁盘后读仍是冻结快照，写方法收尾才刷新
    await writeSkill(root, 'imported')
    const stale = await api.overview({})
    assert.equal(stale.lib.skills.length, 1) // 写屏障前：缓存不失效
    await api.sync({})
    const third = await api.overview({})
    assert.equal(third.lib.skills.length, 2)
    // 配置目录变更 → 缓存键失配 → 冷扫新目录
    const root2 = await mkTmp()
    try {
      await writeSkill(root2, 'other')
      const api2 = buildApi(() => fakeScope(root2), { getStore: () => fakeStore(), backupsRoot: '', globalRoot: groot })
      const fresh = await api2.overview({})
      assert.equal(fresh.lib.skills[0].dir, 'other')
    } finally {
      await cleanup(root2)
    }
  } finally {
    await cleanup(root)
    await cleanup(groot)
  }
})

function skillRecordSelf() {
  return {
    origin: 'self', repo: null, branch: null, commit: null, path_in_repo: null,
    content_hash: null, origin_path: null, installed_at: 't',
  }
}

test('bundle 缓存：并发读返回一致快照', async () => {
  const root = await mkTmp()
  const groot = await mkTmp()
  try {
    await writeSkill(root, 'pdf')
    const api = buildApi(() => fakeScope(root), { getStore: () => fakeStore(), backupsRoot: '', globalRoot: groot })
    const [a, b] = await Promise.all([api.overview({}), api.overview({})])
    assert.equal(a.lib.skills[0].dir, 'pdf')
    assert.equal(b.lib.skills[0].dir, 'pdf')
    assert.deepEqual(a, b) // 同一冷扫快照代际，无中间态
  } finally {
    await cleanup(root)
    await cleanup(groot)
  }
})
