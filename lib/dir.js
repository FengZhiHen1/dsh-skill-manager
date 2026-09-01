// dsh-skill-manager — configured skills directory and safe file access.
//
// 配置命名空间 skill-manager（settings.yaml 的 skill-manager 段）承载全部
// 用户意图（插件运行时.md「配置即意图」）：
//   skillsDir      本地 skills 目录（空串 = 未配置）
//   groups         组集合：{ 组名: { mounts: [{ scope, project }] } }；默认组
//                  「默认」的 schema 默认挂载 = 全局（原 ensureSeedMounts 语义）
//   skills         技能意图：{ 目录名: { disabled, group } }
//   intentMigrated 旧 storage 意图一次性迁移标记（迁移后为 true，UI 不展示）
// validate 只做形式校验（组名格式/意图形状）；引用完整性（组是否存在、
// 工作区是否存在）由对账层容忍回落，不在写路径拒绝——settings 写是字段级
// 原子，跨字段编辑中间态必须放行。

import { isAbsolute } from 'node:path'
import { statSync } from 'node:fs'
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, normalize, relative, resolve, sep } from 'node:path'
import z from 'schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { SkillManagerError } from './errors.js'

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
 * Register the settings namespace. Validation is deliberately form-only:
 * directory existence is a runtime condition handled by requireDir(), and
 * cross-field references (group/workspace existence) are tolerated by the
 * reconciler instead of rejecting writes.
 */
export function registerConfig(ctx) {
  const ns = settingsNamespace(CONFIG_NS)
  return ctx.settings.register(ns, configSchema(), {
    validate: (value) => {
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
    },
  })
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

/** Resolve a relative path below root, rejecting traversal and root itself. */
export function safePath(root, rel) {
  const target = resolve(root, rel)
  const within = relative(resolve(root), target)
  if (within === '' || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) {
    throw new SkillManagerError('bad-path', `路径越出 skills 目录：${rel}`)
  }
  return target
}

/** Return whether path exists and is a directory. */
export async function existsDir(path) {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/** Normalize a relative path for validation and display. */
export function normalizeRel(rel) {
  return normalize(rel).replace(/^([/\\])+/, '').replace(/[/\\]+$/, '')
}

/** Atomically write JSON using a same-directory temporary file and rename. */
export async function writeJson(root, rel, data) {
  const file = safePath(root, rel)
  const dir = dirname(file)
  await mkdir(dir, { recursive: true })
  const tmp = join(dir, `.dsh-sm-tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  try {
    await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
    try {
      await rename(tmp, file)
    } catch (error) {
      // Windows rename cannot replace an existing target.
      if (process.platform === 'win32' && error && (error.code === 'EEXIST' || error.code === 'EPERM')) {
        await rm(file, { force: true })
        await rename(tmp, file)
      } else {
        throw error
      }
    }
  } catch (error) {
    await rm(tmp, { force: true })
    throw new SkillManagerError('write-failed', `写入 ${rel} 失败：${error.message}`, false)
  }
}
