// intent — 配置即意图领域模型：settings 段 schema、形式校验与组纯推导。
//
// 边界：settings 命名空间注册与 @deepseek-ai 平台 import 在 adapter 层。
// 参考：插件运行时.md「配置即意图」；DSR-015。

import { statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import z from 'schemastery'
import { SkillManagerError } from '../base/errors.js'

/** 插件配置的 settings 命名空间名。 */
export const CONFIG_NS = 'skill-manager'
/** 本地 skills 目录的配置键名；空串 = 未配置。 */
export const SKILLS_DIR_FIELD = 'skillsDir'
/** 虚拟默认组（不落 settings.groups 也始终存在）。 */
export const DEFAULT_GROUP = '默认'

const RESERVED_GROUPS = new Set(['默认', '全部'])
const BAD_GROUP_CHARS = /[/\\:*?"<>|\x00-\x1f]/

/**
 * 组名校验（形式约束；settings validate 与客户端建组共用同一规则）。
 * @throws {SkillManagerError} bad-group-name — 空/超长/保留字/含非法字符
 */
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

/**
 * 配置 schema：全部用户意图字段，落在 settings.yaml 的 skill-manager 段。
 * skillsDir      本地 skills 目录绝对路径；空串 = 未配置。
 * groups         组集合 { 组名: { mounts: [{ scope, project }] } }。
 * skills         技能意图 { 目录名: { disabled, group } }。
 * intentMigrated 存量 storage 意图一次性导入标记；导入后 UI 不展示。
 * 默认种子 = 「默认」组挂载全局。
 */
export const configSchema = () => z.object({
  [SKILLS_DIR_FIELD]: z.string().default(''),
  intentMigrated: z.boolean().default(false),
  groups: z.dict(groupSchema()).default({ [DEFAULT_GROUP]: { mounts: [{ scope: 'global', project: null }] } }),
  skills: z.dict(skillIntentSchema()).default({}),
})

/**
 * settings 段形式校验：路径绝对性、组名合法性、意图形状。
 * skillsDir 为空直接跳过——未配置时不拦编辑。
 * 引用完整性（组是否存在、工作区是否存在）由对账层容忍回落，写路径不拒绝。
 * settings 写是字段级原子，跨字段编辑中间态必须放行。
 * @throws {Error} 非绝对路径 / 非法组名（validateGroupName 转抛）/ 意图形状错误
 *   ——settings validate 契约以消息面呈现，不要求稳定码
 */
export function validateConfigIntent(value) {
  const dir = value?.[SKILLS_DIR_FIELD]
  if (typeof dir !== 'string' || dir === '') return
  if (!isAbsolute(dir)) throw new Error('本地 skill 目录必须是绝对路径')
  // 「默认」是虚拟组的合法 groups 键，仅作挂载配置载体。
  // 保留字规则约束命名组创建/改名路径；客户端预检仍走 validateGroupName 全量。
  for (const name of Object.keys(value?.groups ?? {})) {
    if (name !== DEFAULT_GROUP) validateGroupName(name)
  }
  for (const [skillDir, intent] of Object.entries(value?.skills ?? {})) {
    if (!intent || typeof intent !== 'object' || Array.isArray(intent)) {
      throw new Error(`技能意图格式错误：${skillDir}`)
    }
    if (typeof intent.group !== 'string') throw new Error(`技能意图格式错误：${skillDir}（group 必须是字符串）`)
  }
}

/**
 * 解析当前配置的 skills 目录并要求其存在，返回解析后的绝对路径。
 * 每次调用现读配置，目录切换保存后即刻生效。
 * @throws {SkillManagerError} skilldir-unconfigured — 未配置或空串
 * @throws {SkillManagerError} skilldir-missing — 已配置但目录不存在 / 非目录 / 不可访问
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
      throw new SkillManagerError('skilldir-missing', `配置的 skills 目录不是目录：${dir}`, false, [
        { label: '配置的目录', value: dir },
        { label: '解析后路径', value: root },
      ])
    }
  } catch (error) {
    if (error instanceof SkillManagerError) throw error
    throw new SkillManagerError('skilldir-missing', `配置的 skills 目录不存在或不可访问：${dir}`, false, [
      { label: '配置的目录', value: dir },
      { label: '解析后路径', value: root },
    ])
  }
  return root
}
