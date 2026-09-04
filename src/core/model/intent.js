// dsh-skill-manager — 配置即意图领域模型（插件运行时.md「配置即意图」；DSR-015 model 层）。
//
// 配置命名空间 skill-manager（settings.yaml 的 skill-manager 段）承载全部
// 用户意图：
//   skillsDir      本地 skills 目录（空串 = 未配置）
//   groups         组集合：{ 组名: { mounts: [{ scope, project }] } }；默认组
//                  「默认」的 schema 默认挂载 = 全局（原 ensureSeedMounts 语义）
//   skills         技能意图：{ 目录名: { disabled, group } }
//   intentMigrated 旧 storage 意图一次性迁移标记（迁移后为 true，UI 不展示）
// validate 只做形式校验（组名格式/意图形状）；引用完整性（组是否存在、
// 工作区是否存在）由对账层容忍回落，不在写路径拒绝——settings 写是字段级
// 原子，跨字段编辑中间态必须放行。
// P1 搬位说明：本文件 = 原 lib/dir.js 的意图面（settings 命名空间注册与
// @deepseek-ai import 在 src/adapter/settings.js；fs 原语在 src/core/base/fsys.js）
// + 原 lib/groups.js 的组纯推导。registerConfig 的 validate 闭包提为
// validateConfigIntent 具名导出（逻辑逐行未动）。

import { statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import z from 'schemastery'
import { SkillManagerError } from '../base/errors.js'

/** Settings namespace for the plugin configuration. */
export const CONFIG_NS = 'skill-manager'
/** Configured local skills directory; empty string means unconfigured. */
export const SKILLS_DIR_FIELD = 'skillsDir'
/** 虚拟默认组（不落 settings.groups 也始终存在）。 */
export const DEFAULT_GROUP = '默认'

const RESERVED_GROUPS = new Set(['默认', '全部'])
const BAD_GROUP_CHARS = /[/\\:*?"<>|\x00-\x1f]/

/** 组名校验（形式约束；settings validate 与客户端建组共用同一规则）。 */
export function validateGroupName(name) {
  if (typeof name !== 'string' || name.length === 0 || name.length > 30) {
    throw new SkillManagerError('bad-group-name', '组名长度必须为 1 到 30 个字符')
  }
  if (RESERVED_GROUPS.has(name)) throw new SkillManagerError('bad-group-name', `组名「${name}」是保留字`)
  if (BAD_GROUP_CHARS.test(name)) throw new SkillManagerError('bad-group-name', '组名不能包含 / \\ : * ? " < > | 与控制字符')
}

const mountSchema = () => z.object({
  scope: z.union([z.const('global'), z.const('project')]),
  project: z.union([z.string(), z.const(null)]).default(null),
})

const groupSchema = () => z.object({
  mounts: z.array(mountSchema()).default([]),
})

const skillIntentSchema = () => z.object({
  disabled: z.boolean().default(false),
  group: z.string().default(DEFAULT_GROUP),
})

/** 配置 schema：全部用户意图字段。默认种子 = 「默认」组挂载全局。 */
export const configSchema = () => z.object({
  [SKILLS_DIR_FIELD]: z.string().default(''),
  intentMigrated: z.boolean().default(false),
  groups: z.dict(groupSchema()).default({ [DEFAULT_GROUP]: { mounts: [{ scope: 'global', project: null }] } }),
  skills: z.dict(skillIntentSchema()).default({}),
})

/**
 * settings 形式校验（原 lib/dir.js registerConfig 内联 validate 闭包，逐行未动；
 * 引用完整性交由对账层容忍）。
 */
export function validateConfigIntent(value) {
  const dir = value?.[SKILLS_DIR_FIELD]
  if (typeof dir !== 'string' || dir === '') return
  if (!isAbsolute(dir)) throw new Error('本地 skill 目录必须是绝对路径')
  for (const name of Object.keys(value?.groups ?? {})) validateGroupName(name)
  for (const [dir, intent] of Object.entries(value?.skills ?? {})) {
    if (!intent || typeof intent !== 'object' || Array.isArray(intent)) {
      throw new Error(`技能意图格式错误：${dir}`)
    }
    if (typeof intent.group !== 'string') throw new Error(`技能意图格式错误：${dir}（group 必须是字符串）`)
  }
}

/**
 * Resolve the currently configured skills directory and require it to exist.
 * The setting is read on every call so live configuration changes apply
 * immediately.
 */
export function requireDir(scope) {
  const dir = scope.get()[SKILLS_DIR_FIELD]
  if (typeof dir !== 'string' || dir === '') {
    throw new SkillManagerError(
      'skilldir-unconfigured',
      '尚未配置本地 skill 目录：请到 设置 → 插件 → skill-manager 卡片配置。',
    )
  }
  const root = resolve(dir)
  try {
    if (!statSync(root).isDirectory()) {
      throw new SkillManagerError('skilldir-missing', `配置的 skills 目录不是目录：${dir}`)
    }
  } catch (error) {
    if (error instanceof SkillManagerError) throw error
    throw new SkillManagerError('skilldir-missing', `配置的 skills 目录不存在或不可访问：${dir}`)
  }
  return root
}

// ---- 组纯推导（原 lib/groups.js，逐行未动）----
// 组集合与成员归属的唯一事实源是 settings 命名空间（groups 键集合 +
// skills[dir].group）；本模块只做纯推导，不再操作 storage 表。
// 虚拟组 默认 不落配置也始终存在。

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
