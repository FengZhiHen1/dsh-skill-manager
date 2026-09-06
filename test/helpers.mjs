// dsh-skill-manager — 测试公共件：内存假域 + 临时目录夹具 + 最小 ZIP 构造器。
// 假域复刻 storage 域表契约：同步 get/entries/keys/size，异步 put/delete。

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { deflateRawSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { createStore } from '../src/core/model/store.js'

/** 单表假句柄（Map 支撑）。 */
function fakeTable() {
  const map = new Map()
  return {
    get: (key) => map.get(key),
    entries: () => map.entries(),
    keys: () => map.keys(),
    get size() {
      return map.size
    },
    async put(key, record) {
      map.set(key, structuredClone(record))
    },
    async delete(key) {
      return map.delete(key)
    },
  }
}

/** 假域：table(name) 惰性建表；close 幂等。 */
export function fakeDomain() {
  const tables = new Map()
  return {
    table(name) {
      if (!tables.has(name)) tables.set(name, fakeTable())
      return tables.get(name)
    },
    async close() {},
  }
}

/** 经门面包装的假 store（与生产同路径）。 */
export function fakeStore() {
  return createStore(fakeDomain())
}

/** 临时目录；afterEach 清理由调用方负责（返回路径）。 */
export async function mkTmp(prefix = 'dsh-sm-test-') {
  return mkdtemp(join(tmpdir(), prefix))
}

export async function cleanup(dir) {
  await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
}

/** 在目录内写一个最小 skill（SKILL.md + 可选 frontmatter 字段）。 */
export async function writeSkill(root, name, meta = {}) {
  const dir = join(root, name)
  await mkdir(dir, { recursive: true })
  const lines = ['---', `name: ${meta.name ?? name}`, `description: ${meta.description ?? `${name} 描述`}`, '---', '', `# ${name}`, '']
  await writeFile(join(dir, 'SKILL.md'), lines.join('\n'), 'utf8')
  return dir
}

/**
 * 假 settings scope：scope.get() 返回配置意图（skillsDir + 默认组种子 +
 * 可选意图覆盖）。overrides 可传 { groups, skills, intentMigrated, piAgentDir }。
 * piAgentDir 默认指向库内永不创建的桩路径：pi 视为可用但扫描根不存在（readdir 跳过），
 * 隔离本机真实 ~/.pi/agent，测试零环境依赖。
 */
export function fakeScope(skillsDir, overrides = {}) {
  const base = {
    skillsDir,
    piAgentDir: join(skillsDir, '__pi_agent_stub__'),
    intentMigrated: true,
    groups: { 默认: { mounts: [{ scope: 'global', project: null }] } },
    skills: {},
  }
  return { get: () => ({ ...base, ...overrides }) }
}

/** 标准 skills 入库元数据（缺省 self；用 overrides 覆盖字段）。两表面：意图字段（disabled/group）已归 settings，不再出现在记录里。 */
export function skillRecord(overrides = {}) {
  return {
    origin: 'self', repo: null, branch: null, commit: null,
    path_in_repo: null, content_hash: null, origin_path: null,
    installed_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

/** 断言异步调用以指定错误码拒绝（SkillManagerError 契约是 code，不是 message）。 */
export async function assertRejectsCode(promise, code) {
  try {
    await promise
  } catch (error) {
    assert.equal(error.code ?? error.kind, code, `期望错误码 ${code}，实际 ${error.code ?? error.kind}（${error.message}）`)
    return error
  }
  assert.fail(`期望以错误码 ${code} 拒绝，实际成功`)
}

/** 断言同步调用抛出指定错误码。 */
export function assertThrowsCode(fn, code) {
  try {
    fn()
  } catch (error) {
    assert.equal(error.code ?? error.kind, code, `期望错误码 ${code}，实际 ${error.code ?? error.kind}（${error.message}）`)
    return error
  }
  assert.fail(`期望抛出错误码 ${code}，实际未抛`)
}

/** 构造最小 ZIP（中央目录为准；local 头尺寸置 0 模拟流式写入形态；CRC 不校验故置 0）。 */
export function buildZip(entries) {
  const localParts = []
  const centralParts = []
  let offset = 0
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8')
    const data = e.method === 8 ? deflateRawSync(e.data) : e.data
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // UTF-8 标志
    local.writeUInt16LE(e.method, 8)
    local.writeUInt32LE(0, 10)
    local.writeUInt32LE(0, 14) // 流式形态：local 头尺寸为 0
    local.writeUInt32LE(0, 18)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    localParts.push(local, nameBuf, data)
    const cen = Buffer.alloc(46)
    cen.writeUInt32LE(0x02014b50, 0)
    cen.writeUInt16LE(20, 4)
    cen.writeUInt16LE(20, 6)
    cen.writeUInt16LE(0x0800, 8)
    cen.writeUInt16LE(e.method, 10)
    cen.writeUInt32LE(0, 12)
    cen.writeUInt32LE(e.data.length, 20)
    cen.writeUInt32LE(data.length, 24)
    cen.writeUInt16LE(nameBuf.length, 28)
    cen.writeUInt16LE(0, 30)
    cen.writeUInt16LE(0, 32)
    cen.writeUInt16LE(0, 34)
    cen.writeUInt16LE(0, 36)
    cen.writeUInt32LE(0, 38)
    cen.writeUInt32LE(offset, 42)
    centralParts.push(cen, nameBuf)
    offset += local.length + nameBuf.length + data.length
  }
  const cenBuf = Buffer.concat(centralParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cenBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...localParts, cenBuf, eocd])
}
