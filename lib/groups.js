// dsh-skill-manager — 分组（插件运行时.md「配置即意图」）。
// 组集合与成员归属的唯一事实源是 settings 命名空间（groups 键集合 +
// skills[dir].group）；本模块只做纯推导，不再操作 storage 表。
// 虚拟组 默认 不落配置也始终存在。

import { DEFAULT_GROUP } from './dir.js'

/**
 * 从配置意图构造组文档：{ 组名: [成员目录名] }（与推导/对账同形）。
 * existingDirs 提供时只收仍存在的成员（读取时清理已消失成员）。
 * @param {object} configGroups settings 的 groups 段
 * @param {object} configSkills settings 的 skills 段（dir → { disabled, group }）
 * @param {Set<string>|null} existingDirs 库内目录集合
 */
export function makeGroups(configGroups, configSkills, existingDirs = null) {
  const groups = {}
  for (const name of Object.keys(configGroups && typeof configGroups === 'object' ? configGroups : {})) {
    groups[name] = []
  }
  const allowed = existingDirs instanceof Set ? existingDirs : null
  for (const [dir, intent] of Object.entries(configSkills && typeof configSkills === 'object' ? configSkills : {})) {
    const group = intent?.group
    if (group && group !== DEFAULT_GROUP && group in groups && (!allowed || allowed.has(dir))) {
      groups[group].push(dir)
    }
  }
  return { version: 1, groups }
}

/** 组摘要：[{name, count}]。 */
export function groupSummary(groups) {
  return Object.entries(groups && typeof groups === 'object' ? groups : {})
    .map(([name, members]) => ({ name, count: members.length }))
}
