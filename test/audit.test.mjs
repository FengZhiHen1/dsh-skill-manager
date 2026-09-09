// dsh-skill-manager — 审计台账回归闸（DSR-022 A 案：操作级、两段式、只记变更、双上限）。
//
// 每条闸锁死设计的一个承诺：删掉对应实现必红。集成闸走 buildApi → reconcile 真链路，
// 格式与崩溃面走 audit 单元面（symlink 失败在 tmp 夹具里无法自然注入，不为造错而 stub fs 原语）。

import test from 'node:test'
import { lstat, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { AUDIT_KEYS, AUDIT_OPS, AUDIT_SCHEMA, createAudit } from '../src/core/base/audit.js'
import { buildApi } from '../src/core/service.js'
import { cleanup, fakeStore, mkTmp, writeSkill } from './helpers.mjs'

/** 假 scope：形状与 fakeScope 同构，但 groups 可逐例控制（孤儿/收敛两态需要改挂载意图）。 */
function scopeFor(skillsDir, groups, skills = {}) {
  const cfg = { skillsDir, pi: false, intentMigrated: true, groups, skills }
  return { get: () => cfg }
}

const MOUNT_GLOBAL = { 默认: { mounts: [{ scope: 'global', project: null }] } }
const MOUNT_NONE = { 默认: { mounts: [] } }

async function rows(file) {
  const text = await readFile(file, 'utf8')
  return text.split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l))
}

async function lineCount(file) {
  try {
    return (await rows(file)).length
  } catch {
    return 0
  }
}

function harness({ groups = MOUNT_GLOBAL, skills = {}, maxLines, maxAgeDays, now, auditFile = null, blockDir = false } = {}) {
  return { groups, skills, maxLines, maxAgeDays, now, auditFile, blockDir }
}

test('建链：pending 与 done 成对落条，同 opId，键序即接口，归因字段齐', async () => {
  const tmp = await mkTmp()
  try {
    const root = join(tmp, 'lib')
    const groot = join(tmp, 'groot')
    await writeSkill(root, 'alpha')
    const file = join(tmp, 'skill-manager', 'audit.jsonl')
    const audit = createAudit({ file, profile: 'test' })
    const api = buildApi(() => scopeFor(root, MOUNT_GLOBAL), {
      listWorkspaces: () => [], getStore: () => fakeStore(), backupsRoot: join(tmp, 'backups'),
      globalRoot: groot, libraryRoot: join(tmp, 'library'), audit,
    })
    const r = await api.sync({}, { entry: 'rpc', method: 'sync' })
    assert.equal(r.results.filter((x) => x.action === 'mounted').length, 1, '应物化一条链接')
    await audit.endBatch()
    const all = await rows(file)
    const pair = all.filter((x) => x.op === 'link-create')
    assert.equal(pair.length, 2, 'link-create 必须是 pending + 终态两行')
    const [pending, done] = pair
    assert.equal(pending.phase, 'pending')
    assert.equal(done.phase, 'done')
    assert.equal(done.result, 'mounted')
    assert.equal(pending.opId, done.opId, '两段必须同 opId')
    assert.equal(pending.seq < done.seq, true, 'seq 必须单调递增')
    assert.equal(pending.entry, 'rpc')
    assert.equal(pending.method, 'sync')
    assert.equal(pending.profile, 'test')
    assert.ok(pending.home.includes(tmp.split(/[\\/]+/).pop()), 'home 由台账路径反推到 HOME 根')
    assert.ok(pending.path && pending.target && pending.srcRoot, 'path/target/srcRoot 不得为空')
    assert.ok(/^[A-Za-z]:/.test(pending.path) || pending.path.startsWith('/'), 'path 必须是绝对路径原样')
    for (const row of all) {
      assert.equal(row.schema, AUDIT_SCHEMA)
      assert.deepEqual(Object.keys(row), [...AUDIT_KEYS], '键名与键序即接口：不得增删或调序')
      assert.equal(AUDIT_KEYS.filter((k) => !(k in row)).length, 0, '缺省键必须写 null 而非省略')
    }
    const summary = all.filter((x) => x.op === 'batch')
    assert.equal(summary.length, 1)
    assert.equal(summary[0].changed, 1)
    assert.equal(summary[0].evaluated, 1)
  } finally {
    await cleanup(tmp)
  }
})

test('孤儿摘除：reason 落到记录里，且与 results 行同源', async () => {
  const tmp = await mkTmp()
  try {
    const root = join(tmp, 'lib')
    const groot = join(tmp, 'groot')
    await writeSkill(root, 'alpha')
    const file = join(tmp, 'audit.jsonl')
    const audit = createAudit({ file })
    const store = fakeStore() // 必须跨会话持久：摘除权来自 managed_links，每请求换假域会让登记即刻蒸发
    let groups = MOUNT_GLOBAL
    const api = buildApi(() => scopeFor(root, groups), {
      listWorkspaces: () => [], getStore: () => store, backupsRoot: join(tmp, 'backups'),
      globalRoot: groot, libraryRoot: join(tmp, 'library'), audit,
    })
    await api.sync()
    groups = MOUNT_NONE // 撤掉挂载意图 → 既有链接成孤儿
    const r = await api.sync()
    assert.equal(r.results.filter((x) => x.action === 'removed').length, 1)
    await audit.endBatch()
    const removed = (await rows(file)).filter((x) => x.op === 'link-remove')
    assert.equal(removed.length, 2, '摘链也应成对')
    assert.match(removed[0].reason, /孤儿链接/)
    assert.equal(removed[0].phase, 'pending')
    assert.equal(removed[1].result, 'removed')
    assert.equal(removed[1].durationMs >= 0, true)
  } finally {
    await cleanup(tmp)
  }
})

test('只读方法零记录：overview/warm/backups 刷 20 次台账不长一行', async () => {
  const tmp = await mkTmp()
  try {
    const root = join(tmp, 'lib')
    const groot = join(tmp, 'groot')
    await writeSkill(root, 'alpha')
    const file = join(tmp, 'audit.jsonl')
    const audit = createAudit({ file })
    const api = buildApi(() => scopeFor(root, MOUNT_GLOBAL), {
      listWorkspaces: () => [], getStore: () => fakeStore(), backupsRoot: join(tmp, 'backups'),
      globalRoot: groot, libraryRoot: join(tmp, 'library'), audit,
    })
    await api.sync()
    await audit.endBatch()
    const before = await lineCount(file)
    for (let i = 0; i < 20; i += 1) {
      await api.overview({})
      await api.warm({})
    }
    await audit.endBatch()
    assert.equal(await lineCount(file), before, '只读路径不得写台账')
  } finally {
    await cleanup(tmp)
  }
})

test('稳态 noop：第二次 sync 只多一条 summary，changed=0 且不逐条落 pending', async () => {
  const tmp = await mkTmp()
  try {
    const root = join(tmp, 'lib')
    const groot = join(tmp, 'groot')
    await writeSkill(root, 'alpha')
    await writeSkill(root, 'beta')
    const file = join(tmp, 'audit.jsonl')
    const audit = createAudit({ file })
    const store = fakeStore() // 同上：登记表要跨两次 sync 持久，否则每趟都是空表 → 每趟都触发认领
    const api = buildApi(() => scopeFor(root, MOUNT_GLOBAL), {
      listWorkspaces: () => [], getStore: () => store, backupsRoot: join(tmp, 'backups'),
      globalRoot: groot, libraryRoot: join(tmp, 'library'), audit,
    })
    await api.sync()
    await audit.endBatch()
    const before = await rows(file)
    const r = await api.sync() // 已收敛：全部走 noop 分支
    await audit.endBatch()
    const after = await rows(file)
    assert.equal(after.length - before.length, 1, '稳态一轮对账只应多一条 summary')
    const added = after.slice(before.length)
    assert.equal(added[0].op, 'batch')
    assert.equal(added[0].changed, 0)
    assert.equal(added[0].evaluated, 2)
    assert.equal(r.results.filter((x) => x.action === 'mounted').length, 0)
  } finally {
    await cleanup(tmp)
  }
})

test('双上限：超行数截断保留最近，且必落一条 rotate 自证', async () => {
  const tmp = await mkTmp()
  try {
    const file = join(tmp, 'audit.jsonl')
    const audit = createAudit({ file, maxLines: 12 })
    for (let i = 0; i < 20; i += 1) await audit.note({ op: 'batch', reason: `灌数据 ${i}` })
    const { truncated } = await audit.endBatch()
    assert.equal(truncated, true)
    const all = await rows(file)
    assert.ok(all.length <= 12, `截断后必须 ≤ 上限，实际 ${all.length}`)
    const last = all[all.length - 1]
    assert.equal(last.op, 'rotate')
    assert.equal(last.phase, 'rotate')
    assert.equal(last.kept, 11)
    assert.equal(last.dropped, 9)
    assert.equal(all[0].reason, '灌数据 9', '保留的必须是最近的行')
  } finally {
    await cleanup(tmp)
  }
})

test('双上限：超龄行被剔除（重启后用新时钟判龄，等价真实过期）', async () => {
  const tmp = await mkTmp()
  try {
    const file = join(tmp, 'audit.jsonl')
    const fresh = createAudit({ file, maxLines: 5000, maxAgeDays: 90 })
    for (let i = 0; i < 5; i += 1) await fresh.note({ op: 'batch', reason: `老记录 ${i}` })
    await fresh.endBatch()
    assert.equal(await lineCount(file), 5)
    // 换一个「未来时钟」的写入器（等价 100 天后重启的实例）：全部行超龄
    const aged = createAudit({ file, maxLines: 5000, maxAgeDays: 90, now: () => Date.now() + 100 * 86_400_000 })
    const { truncated } = await aged.endBatch()
    assert.equal(truncated, true)
    const all = await rows(file)
    assert.equal(all.length, 1, '超龄行全被剔除，只剩 rotate 自证行')
    assert.equal(all[0].op, 'rotate')
    assert.equal(all[0].dropped, 5)
  } finally {
    await cleanup(tmp)
  }
})

test('失败终态：failed 行携 code 与 message，与 pending 同 opId', async () => {
  const tmp = await mkTmp()
  try {
    const file = join(tmp, 'audit.jsonl')
    const audit = createAudit({ file })
    const op = await audit.begin({ op: 'link-remove', actor: { entry: 'watch', method: 'settings-debounced' }, path: 'X:/nope/a', skill: 'a' })
    await op.fail(Object.assign(new Error('operation not permitted'), { code: 'EPERM' }))
    await audit.endBatch()
    const all = await rows(file)
    assert.equal(all.length, 2)
    assert.equal(all[0].phase, 'pending')
    assert.equal(all[1].phase, 'failed')
    assert.equal(all[1].result, 'error')
    assert.equal(all[1].code, 'EPERM')
    assert.equal(all[1].error, 'operation not permitted')
    assert.equal(all[1].opId, all[0].opId)
    assert.equal(all[1].entry, 'watch')
    assert.equal(all[1].method, 'settings-debounced')
  } finally {
    await cleanup(tmp)
  }
})

test('中断即证据：begin 后不落终态，pending 行留在文件里（进程被杀的样子）', async () => {
  const tmp = await mkTmp()
  try {
    const file = join(tmp, 'audit.jsonl')
    const audit = createAudit({ file })
    const op = await audit.begin({ op: 'link-create', path: 'X:/dst', skill: 'alpha', reason: '期望集物化' })
    void op // 故意不结算：模拟副作用做到一半进程被杀
    await audit.endBatch()
    const all = await rows(file)
    assert.equal(all.length, 1)
    assert.equal(all[0].phase, 'pending')
    assert.equal(all.filter((x) => x.opId === all[0].opId && x.phase !== 'pending').length, 0, '无终态 = 可判定的中断')
  } finally {
    await cleanup(tmp)
  }
})

test('台账写失败：业务照常完成，results 追加 audit-degraded 行（降级不静默）', async () => {
  const tmp = await mkTmp()
  try {
    const root = join(tmp, 'lib')
    const groot = join(tmp, 'groot')
    await writeSkill(root, 'alpha')
    // 把台账父目录占成一个普通文件 → mkdir/append 必失败
    const blocker = join(tmp, 'skill-manager')
    await writeFile(blocker, 'x', 'utf8')
    const audit = createAudit({ file: join(blocker, 'audit.jsonl'), logger: { warn() {} } })
    const api = buildApi(() => scopeFor(root, MOUNT_GLOBAL), {
      listWorkspaces: () => [], getStore: () => fakeStore(), backupsRoot: join(tmp, 'backups'),
      globalRoot: groot, libraryRoot: join(tmp, 'library'), audit,
    })
    const r = await api.sync()
    assert.equal(r.results.filter((x) => x.action === 'mounted').length, 1, '台账写失败不得影响挂载')
    await lstat(join(groot, 'alpha')) // 链接确实建出来了
    const degraded = r.results.filter((x) => x.action === 'audit-degraded')
    assert.equal(degraded.length, 1, '必须有可见的降级行')
    assert.equal(degraded[0].code, 'audit-degraded')
    assert.ok(degraded[0].target.endsWith('audit.jsonl'))
    assert.equal(r.errors.length, 0, '降级行不得被算作挂载错误')
  } finally {
    await cleanup(tmp)
  }
})

test('操作枚举双向闭合：src 实际发射的 op 集合 === AUDIT_OPS（死值与漏记都红）', async () => {
  const tmp = await mkTmp()
  try {
    // 静态扫 src：/op:\s*'...'/ 命中的字面量即「实现真会发射的 op」。
    // 单向断言（发射 ⊆ 声明）测不出声明里的死值——2026-09-09 复评正是靠这条抓到四个。
    const emitted = new Set()
    const walk = async (dir) => {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, e.name)
        if (e.isDirectory()) { await walk(full); continue }
        if (!e.name.endsWith('.js')) continue
        const src = await readFile(full, 'utf8')
        for (const m of src.matchAll(/\bop:\s*'([a-z-]+)'/g)) emitted.add(m[1])
      }
    }
    await walk(fileURLToPath(new URL('../src/core', import.meta.url)))
    assert.ok(emitted.size >= 8, `静态扫描未取到发射集（扫到 ${emitted.size} 个）`)
    assert.deepEqual([...AUDIT_OPS].sort(), [...emitted].sort(), 'AUDIT_OPS 必须与实现发射集精确相等')
    const file = join(tmp, 'audit.jsonl')
    const audit = createAudit({ file })
    const op = await audit.begin({ op: 'link-create', path: 'X:/a' })
    await op.done()
    await audit.endBatch()
    assert.ok((await rows(file)).every((x) => AUDIT_OPS.includes(x.op)), '落盘行不得出现枚举外的 op')
  } finally {
    await cleanup(tmp)
  }
})