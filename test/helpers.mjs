// dsh-skill-manager — 测试公共件：内存假域 + 临时目录夹具。
// 假域复刻 storage 域表契约：同步 get/entries/keys/size，异步 put/delete/update。

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
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
    async update(key, fn) {
      if (!map.has(key)) {
        const error = new Error('missing-key')
        error.code = 'missing-key'
        throw error
      }
      map.set(key, structuredClone(fn(structuredClone(map.get(key)))))
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
 * 可选意图覆盖）。overrides 可传 { groups, skills, intentMigrated }。
 */
export function fakeScope(skillsDir, overrides = {}) {
  const base = {
    skillsDir,
    intentMigrated: true,
    groups: { 默认: { mounts: [{ scope: 'global', project: null }] } },
    skills: {},
  }
  return { get: () => ({ ...base, ...overrides }) }
}

/** 标准 skills 记录（缺省 self；用 overrides 覆盖字段）。 */
export function skillRecord(overrides = {}) {
  return {
    origin: 'self', repo: null, branch: null, commit: null,
    path_in_repo: null, content_hash: null, origin_path: null,
    installed_at: '2026-08-01T00:00:00.000Z', disabled: false, group: '默认',
    ...overrides,
  }
}

/** 断言异步调用以指定错误码拒绝（SkillManagerError/ApiError 契约是 code，不是 message）。 */
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
