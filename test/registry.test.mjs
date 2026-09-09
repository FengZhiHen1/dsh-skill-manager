// registry — 挂载归属登记表（managed_links）语义（DSR-022 B 案；验证计划第 6/7/9 条）。
// 夹具全部走 mkTmp 临时根 + 内存假域，真实 HOME 与真实工作区不被触碰。

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { createAudit } from '../src/core/base/audit.js'
import { isLink, materializeOne, removeLink } from '../src/core/mount/materialize.js'
import { createLinkRegistry, managedKey } from '../src/core/mount/registry.js'
import { reconcile } from '../src/core/mount/reconcile.js'
import { cleanup, fakeStore, mkTmp, writeSkill } from './helpers.mjs'

const MOUNT = [{ group: 'g1', scope: 'global', project: null }]

async function rows(file) {
  const text = await readFile(file, 'utf8')
  return text.split('\n').filter((l) => l !== '').map((l) => JSON.parse(l))
}

/** 一个「实例」= 一份 store（HOME 隔离的自然边界）+ 一个登记表，挂载现场可共享。 */
async function instance(root) {
  const store = fakeStore()
  const registry = createLinkRegistry({ store })
  await registry.load()
  return { store, registry }
}

test('managedKey：绝对化 + 小写归一（表键与台账 path、期望集三处可 JOIN 的前提）', () => {
  assert.equal(managedKey('X:\\Users\\Feng\\.dsh\\skills\\PDF'), 'x:\\users\\feng\\.dsh\\skills\\pdf')
  assert.equal(managedKey(join('sub', 'a')), managedKey('sub/a'))
})

test('第 6 条 · 跨实例隔离：两实例共享同一配置目录，A 建的链接在 B 的对账里必死不了', async () => {
  const tmp = await mkTmp()
  try {
    const sharedRoot = join(tmp, 'config-dir') // 两实例的 skillsDir 指向同一目录——09-08 事故的形状
    await mkdir(sharedRoot, { recursive: true })
    await writeSkill(sharedRoot, 'pdf')
    const groot = join(tmp, 'groot')
    const a = await instance(sharedRoot)
    const b = await instance(sharedRoot)
    const opts = (inst) => ({ root: sharedRoot, mounts: MOUNT, workspacesById: new Map(), globalRootPath: groot, registry: inst.registry })
    const ra = await reconcile({ ...opts(a), memberships: new Map([['pdf', 'g1']]) })
    assert.equal(ra.results.find((x) => x.name === 'pdf')?.action, 'mounted')
    const link = join(groot, 'pdf')
    assert.ok(await isLink(link))
    assert.ok(a.registry.has(link), 'A 侧登记在册')
    assert.equal(b.registry.has(link), false, 'B 侧看不见 A 的登记（HOME 隔离）')
    // B 的期望集为空：旧前缀判据下这里正是「自有且多余 → 摘除」，即生产事故本身
    const rb = await reconcile({ ...opts(b), memberships: new Map() })
    assert.equal(rb.results.find((x) => x.name === 'pdf')?.action, undefined, 'B 不得对 A 的链接做任何处置')
    assert.ok(await isLink(link), '链接必须活着')
    assert.ok(rb.warnings.some((w) => /不在本实例归属登记内/.test(w)), '未登记残留要显式报告')
  } finally {
    await cleanup(tmp)
  }
})

test('第 7 条 · adopt 边界：表空时只认领期望集内的既有链接，其余永不收编', async () => {
  const tmp = await mkTmp()
  try {
    const root = join(tmp, 'lib')
    await mkdir(root, { recursive: true })
    await writeSkill(root, 'pdf')
    await writeSkill(root, 'old')
    const groot = join(tmp, 'groot')
    await mkdir(groot, { recursive: true })
    const inDesired = join(groot, 'pdf')
    const stray = join(groot, 'old') // 指向库内、但配置已不再要求它
    await symlink(join(root, 'pdf'), inDesired, 'junction')
    await symlink(join(root, 'old'), stray, 'junction')
    const file = join(tmp, 'audit.jsonl')
    const audit = createAudit({ file })
    const inst = await instance(root)
    const r = await reconcile({
      root, mounts: MOUNT, workspacesById: new Map(), globalRootPath: groot,
      memberships: new Map([['pdf', 'g1']]), audit, registry: inst.registry,
    })
    await audit.endBatch()
    assert.ok(await isLink(inDesired), '期望内的既有链接被认领，不动现场')
    assert.ok(inst.registry.has(inDesired), '认领 = 写入登记')
    assert.ok(await isLink(stray), '期望外的既有链接**不**被认领（否则下一趟就当自有孤儿摘掉，跨实例通道重开）')
    assert.equal(inst.registry.has(stray), false)
    assert.ok(!r.results.some((x) => x.action === 'removed'), '本趟零摘除')
    const adopted = (await rows(file)).filter((x) => x.op === 'adopt')
    assert.equal(adopted.length, 1, '认领必须落一条自证行')
    assert.equal(adopted[0].changed, 1)
    assert.match(adopted[0].reason, /首次认领/)
    // 第二趟：表已非空 → 不再触发认领，期望外的链接依旧只报不摘
    const r2 = await reconcile({
      root, mounts: MOUNT, workspacesById: new Map(), globalRootPath: groot,
      memberships: new Map([['pdf', 'g1']]), audit, registry: inst.registry,
    })
    await audit.endBatch()
    assert.equal(r2.results.find((x) => x.name === 'pdf')?.action, 'ok')
    assert.ok(await isLink(stray))
    assert.equal((await rows(file)).filter((x) => x.op === 'adopt').length, 1, '认领只发生一次')
  } finally {
    await cleanup(tmp)
  }
})

test('第 9 条 · 三分支之一：登记表读不出来 → 零摘除零认领（建链照常）+ 警告', async () => {
  const tmp = await mkTmp()
  try {
    const root = join(tmp, 'lib')
    await mkdir(root, { recursive: true })
    await writeSkill(root, 'pdf')
    await writeSkill(root, 'gone')
    const groot = join(tmp, 'groot')
    await mkdir(groot, { recursive: true })
    const legacy = join(groot, 'gone')
    await symlink(join(root, 'gone'), legacy, 'junction')
    const broken = { ...fakeStore(), linkEntries() { throw new Error('domain-unavailable') } }
    const registry = createLinkRegistry({ store: broken })
    const r = await reconcile({
      root, mounts: MOUNT, workspacesById: new Map(), globalRootPath: groot,
      memberships: new Map([['pdf', 'g1']]), registry,
    })
    assert.ok(await isLink(join(groot, 'pdf')), '建链不需要摘除权，照常收敛期望集')
    assert.ok(await isLink(legacy), '表读不出来时一律不摘（宁可残留）')
    assert.equal(registry.available, false)
    assert.equal(registry.has(legacy), false, '不可读时不得凭空造出认领（表内那条旧现场无人认领）')
    assert.ok(r.warnings.some((w) => /登记表不可读/.test(w)), '不可读必须显式报告，不静默')
    assert.equal(r.errors.length, 0, '降级不算挂载错误')
  } finally {
    await cleanup(tmp)
  }
})

test('登记写失败：链接照常生效，对账追加 registry-degraded 行且不计入 errors', async () => {
  const tmp = await mkTmp()
  try {
    const root = join(tmp, 'lib')
    await mkdir(root, { recursive: true })
    await writeSkill(root, 'pdf')
    const groot = join(tmp, 'groot')
    const failing = { ...fakeStore(), async putLink() { throw new Error('storage-busy') } }
    const registry = createLinkRegistry({ store: failing })
    await registry.load()
    const r = await reconcile({ root, mounts: MOUNT, workspacesById: new Map(), globalRootPath: groot, memberships: new Map([['pdf', 'g1']]), registry })
    assert.ok(await isLink(join(groot, 'pdf')), '登记失败不回滚已成功的建链')
    const degraded = r.results.filter((x) => x.action === 'registry-degraded')
    assert.equal(degraded.length, 1)
    assert.equal(degraded[0].code, 'registry-degraded')
    assert.match(degraded[0].error, /下次对账无法据登记摘除/)
    assert.equal(r.errors.length, 0)
  } finally {
    await cleanup(tmp)
  }
})

test('摘链即销登记：现场删除后表内不留悬挂登记，未登记路径也幂等', async () => {
  const tmp = await mkTmp()
  try {
    const root = join(tmp, 'lib')
    await mkdir(root, { recursive: true })
    await writeSkill(root, 'pdf')
    const groot = join(tmp, 'groot')
    const inst = await instance(root)
    const dst = join(groot, 'pdf')
    await materializeOne({ root, skill: 'pdf', t: { scope: 'global', project: null }, workspacesById: new Map(), globalRootPath: groot, registry: inst.registry })
    assert.ok(inst.registry.has(dst))
    await removeLink({ path: dst, registry: inst.registry })
    assert.equal(inst.registry.has(dst), false, '摘除后登记必须同步消失，否则下次对账会去删不存在的现场')
    await removeLink({ path: join(groot, 'never-registered'), registry: inst.registry })
    assert.equal(inst.registry.failures, 0, '幂等销账不得计为写失败')
  } finally {
    await cleanup(tmp)
  }
})
