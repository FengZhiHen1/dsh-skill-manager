// dsh-skill-manager — 分组（workshop-files.md groups.json；requirements.md R-03/R-06）。
// 单组归属；未出现在任何命名组的 skill 属虚拟组「默认」。组名校验：
// 1-30 字符，保留字「默认/全部」与空串不可用，不含 / \ : * ? " < > | 与控制字符。

import { WorkshopError } from './errors.js'
import { readJson, writeJson } from './workshop.js'

const GROUPS_REL = 'distributor/groups.json'
const RESERVED = new Set(['默认', '全部'])
const BAD_CHARS = /[/\\:*?"<>|\x00-\x1f]/

export const DEFAULT_GROUP = null // 虚拟组「默认」用 null 表示

export function validateGroupName(name) {
  if (typeof name !== 'string' || name.length === 0 || name.length > 30) {
    throw new WorkshopError('bad-group-name', '组名长度必须为 1 到 30 个字符')
  }
  if (RESERVED.has(name)) {
    throw new WorkshopError('bad-group-name', `组名「${name}」是保留字`)
  }
  if (BAD_CHARS.test(name)) {
    throw new WorkshopError('bad-group-name', '组名不能包含 / \\ : * ? " < > | 与控制字符')
  }
}

/** groups.json：缺失按空骨架 {version:1, groups:{}}；读取时清理已消失成员（内存内）。 */
export async function loadGroups(root, existingDirs) {
  const data = await readJson(root, GROUPS_REL)
  const raw = data === null ? {} : data.groups
  if (typeof raw !== 'object' || raw === null) {
    throw new WorkshopError('workshop-corrupt', 'distributor/groups.json 形状非法（groups 缺失）')
  }
  const groups = {}
  for (const [group, members] of Object.entries(raw)) {
    groups[group] = Array.isArray(members)
      ? members.filter((m) => typeof m === 'string' && existingDirs.has(m))
      : []
  }
  return { version: 1, groups }
}

export async function saveGroups(root, groupsDoc) {
  await writeJson(root, GROUPS_REL, groupsDoc)
}

export function createGroup(groupsDoc, name) {
  validateGroupName(name)
  if (name in groupsDoc.groups) {
    throw new WorkshopError('group-exists', `组「${name}」已存在`)
  }
  groupsDoc.groups[name] = []
  return groupsDoc
}

export function renameGroup(groupsDoc, oldName, newName) {
  validateGroupName(newName)
  if (!(oldName in groupsDoc.groups)) {
    throw new WorkshopError('group-not-found', `组「${oldName}」不存在`)
  }
  if (newName in groupsDoc.groups) {
    throw new WorkshopError('group-exists', `组「${newName}」已存在`)
  }
  groupsDoc.groups[newName] = groupsDoc.groups[oldName]
  delete groupsDoc.groups[oldName]
  return groupsDoc
}

/** 删除组：成员回落虚拟组「默认」（requirements.md R-06）。 */
export function deleteGroup(groupsDoc, name) {
  if (!(name in groupsDoc.groups)) {
    throw new WorkshopError('group-not-found', `组「${name}」不存在`)
  }
  delete groupsDoc.groups[name]
  return groupsDoc
}

/** 行内换组：name 为 null 时移入虚拟组「默认」。 */
export function setMembership(groupsDoc, skillDir, group) {
  for (const members of Object.values(groupsDoc.groups)) {
    const at = members.indexOf(skillDir)
    if (at !== -1) members.splice(at, 1)
  }
  if (group === null) return groupsDoc
  validateGroupName(group)
  if (!(group in groupsDoc.groups)) {
    throw new WorkshopError('group-not-found', `组「${group}」不存在`)
  }
  if (!groupsDoc.groups[group].includes(skillDir)) groupsDoc.groups[group].push(skillDir)
  return groupsDoc
}

/** 从所有组移除成员（出库/禁用时调用）。 */
export function removeMember(groupsDoc, skillDir) {
  for (const members of Object.values(groupsDoc.groups)) {
    const at = members.indexOf(skillDir)
    if (at !== -1) members.splice(at, 1)
  }
  return groupsDoc
}

/** 组清单（含成员数），供 UI 展示。 */
export function groupSummary(groups) {
  return Object.entries(groups).map(([name, members]) => ({ name, count: members.length }))
}
