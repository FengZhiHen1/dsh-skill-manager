// dsh-skill-manager — configured skills directory and safe file access.
//
// The configured directory is a pure, flat skills directory (DSR-010):
// settings.skill-manager.skillsDir is empty when unconfigured, and directory
// existence is checked at runtime so a missing directory does not prevent the
// plugin from loading.

import { statSync } from 'node:fs'
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import z from 'schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { SkillManagerError } from './errors.js'

/** Settings namespace for the plugin configuration. */
export const CONFIG_NS = 'skill-manager'
/** Configured local skills directory; empty string means unconfigured. */
export const SKILLS_DIR_FIELD = 'skillsDir'

/** Settings schema: the only field is skillsDir, defaulting to empty. */
export const configSchema = () =>
  z.object({
    [SKILLS_DIR_FIELD]: z.string().default(''),
  })

/**
 * Register the settings namespace. Validation is deliberately form-only:
 * directory existence is a runtime condition handled by requireDir().
 */
export function registerConfig(ctx) {
  const ns = settingsNamespace(CONFIG_NS)
  return ctx.settings.register(ns, configSchema(), {
    validate: (value) => {
      const dir = value?.[SKILLS_DIR_FIELD]
      if (typeof dir !== 'string' || dir === '') return
      if (!isAbsolute(dir)) throw new Error('本地 skill 目录必须是绝对路径')
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
