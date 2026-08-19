// dsh-skill-manager — 分组（storage-model.md groups 表与 skills.group 字段）。
// 组存在性存 groups 表（含暂无成员的新组）；成员归属即 skills.group 字段；
// 虚拟组 默认 不落表。

import { SkillManagerError } from './errors.js'

const RESERVED = new Set(['默认', '全部'])
const BAD_CHARS = /[/\\:*?"<>|\x00-\x1f]/

/** move 入参：null 表示虚拟组 默认。 */
export const DEFAULT_GROUP = null

export function validateGroupName(name) {
  if (typeof name !== 'string' || name.length === 0 || name.length > 30) {
    throw new SkillManagerError('bad-group-name', '组名长度必须为 1 到 30 个字符')
  }
  if (RESERVED.has(name)) throw new SkillManagerError('bad-group-name', `组名「${name}」是保留字`)
  if (BAD_CHARS.test(name)) throw new SkillManagerError('bad-group-name', '组名不能包含 / \\ : * ? " < > | 与控制字符')
}

function assertStore(store) {
  if (!store || typeof store.groupEntries !== 'function' || typeof store.getSkill !== 'function') {
    throw new TypeError('groups requires a storage store facade')
  }
}

/**
 * 组文档：{ version:1, groups: {组名: [成员目录名]} }（与推导/对账同形）。
 * existingDirs 提供时只收仍存在的成员（读取时清理已消失成员）。
 */
export async function loadGroups(store, existingDirs = null) {
  assertStore(store)
  const groups = {}
  for (const [name] of store.groupEntries()) groups[name] = []
  const allowed = existingDirs instanceof Set ? existingDirs : null
  for (const [name, skill] of store.skillEntries()) {
    const group = skill?.group
    if (group && group !== '默认' && group in groups && (!allowed || allowed.has(name))) {
      groups[group].push(name)
    }
  }
  return { version: 1, groups }
}

export async function createGroup(store, name) {
  assertStore(store)
  validateGroupName(name)
  if (store.getGroup(name)) throw new SkillManagerError('group-exists', `组「${name}」已存在`)
  await store.putGroup(name, { created_at: new Date().toISOString() })
}

export async function renameGroup(store, oldName, newName) {
  assertStore(store)
  validateGroupName(newName)
  const record = store.getGroup(oldName)
  if (!record) throw new SkillManagerError('group-not-found', `组「${oldName}」不存在`)
  if (store.getGroup(newName)) throw new SkillManagerError('group-exists', `组「${newName}」已存在`)
  await store.putGroup(newName, { created_at: record.created_at })
  await store.deleteGroup(oldName)
  for (const [name, skill] of store.skillEntries()) {
    if (skill?.group === oldName) await store.putSkill(name, { ...skill, group: newName })
  }
  for (const [, mount] of store.mountEntries()) {
    if (mount.group === oldName) {
      await store.deleteMount(mount)
      await store.putMount({ ...mount, group: newName })
    }
  }
}

/** 删除组：成员回落 默认 组，该组挂载规则删除（storage-model.md）。 */
export async function deleteGroup(store, name) {
  assertStore(store)
  if (!store.getGroup(name)) throw new SkillManagerError('group-not-found', `组「${name}」不存在`)
  await store.deleteGroup(name)
  for (const [skillName, skill] of store.skillEntries()) {
    if (skill?.group === name) await store.putSkill(skillName, { ...skill, group: '默认' })
  }
  for (const [, mount] of store.mountEntries()) {
    if (mount.group === name) await store.deleteMount(mount)
  }
}

/** 换组：group 为 null 表示回落虚拟组 默认。 */
export async function setMembership(store, skillDir, group) {
  assertStore(store)
  const skill = store.getSkill(skillDir)
  if (!skill) throw new SkillManagerError('not-found', `库中不存在 skill: ${skillDir}`)
  if (group !== null && group !== '默认') {
    validateGroupName(group)
    if (!store.getGroup(group)) throw new SkillManagerError('group-not-found', `组「${group}」不存在`)
  }
  await store.putSkill(skillDir, { ...skill, group: group ?? '默认' })
}

/** 摘出命名组（回落 默认）；记录不存在时静默。 */
export async function removeMember(store, skillDir) {
  assertStore(store)
  const skill = store.getSkill(skillDir)
  if (skill) await store.putSkill(skillDir, { ...skill, group: '默认' })
}

/** 组摘要：[{name, count}]。 */
export function groupSummary(groups) {
  return Object.entries(groups && typeof groups === 'object' ? groups : {})
    .map(([name, members]) => ({ name, count: members.length }))
}
