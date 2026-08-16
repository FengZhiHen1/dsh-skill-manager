// dsh-skill-manager — 车间根配置与车间文件读写。
//
// 权威语义见 docs/design/dsh-skill-manager/：
// - R-22 / DSR-005：车间根来自 settings 命名空间 skill-manager.workshopDir，
//   默认为空串即未配置；未配置时插件不访问任何车间路径。
// - 配置校验：保存期只做形式校验（非空必须是绝对路径）；目录存在性是运行期
//   条件（requireRoot 返回 workshop-missing），避免注册期 validate 失败拖垮启动。
// - 车间根每次按当前配置值解析，不做启动缓存，配置变更即时生效。
// - 文件缺失按空骨架处理（workshop-files.md 车间根读取语义）；文件存在但
//   JSON 解析失败返回 workshop-corrupt，禁止以空对象覆盖损坏文件。
// - 所有 JSON 写入：同目录临时文件 + rename 覆盖（Windows rename 不能覆盖
//   时先删除目标再 rename）。

import { statSync } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, dirname, join, normalize, relative, resolve, sep } from 'node:path'
import z from 'schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { WorkshopError } from './errors.js'

/** settings 命名空间：插件配置选项（requirements.md R-22）。 */
export const CONFIG_NS = 'skill-manager'
/** 配置字段：本地 skill 目录（车间根），默认为空串 = 未配置。 */
export const WORKSHOP_DIR_FIELD = 'workshopDir'

/** settings 命名空间 schema：唯一字段 workshopDir，默认空串。 */
export const configSchema = () =>
  z.object({
    [WORKSHOP_DIR_FIELD]: z.string().default(''),
  })

/**
 * 注册配置命名空间；返回配置 scope（get() 得到当前解析值）。
 * validate 只做稳定的形式校验（绝对路径）：目录存在性是运行期条件
 * （requireRoot 检查并返回 workshop-missing），不能放进注册期 validate——
 * 平台契约中「存储段校验失败会使注册本身失败」，若配置的车间目录被删除，
 * 插件会在下次启动时整体加载失败。
 */
export function registerConfig(ctx) {
  const ns = settingsNamespace(CONFIG_NS)
  return ctx.settings.register(ns, configSchema(), {
    validate: (value) => {
      const dir = value?.[WORKSHOP_DIR_FIELD]
      if (typeof dir !== 'string' || dir === '') return
      if (!isAbsolute(dir)) {
        throw new Error('本地 skill 目录必须是绝对路径')
      }
    },
  })
}

/**
 * 车间根门禁：返回当前配置的车间根；未配置抛 workshop-unconfigured；
 * 配置的目录缺失/不可访问抛 workshop-missing（插件保持存活，不阻塞启动）。
 * @param {import('@deepseek-ai/dsh-settings').SettingsScope<{workshopDir: string}>} scope
 */
export function requireRoot(scope) {
  const dir = scope.get()[WORKSHOP_DIR_FIELD]
  if (typeof dir !== 'string' || dir === '') throw new WorkshopError(
    'workshop-unconfigured',
    '尚未配置本地 skill 目录：请到 设置 → 插件 → skill-manager 卡片配置车间根后使用。',
  )
  const root = resolve(dir)
  try {
    if (!statSync(root).isDirectory()) {
      throw new WorkshopError('workshop-missing', `配置的车间目录不是目录：${dir}`)
    }
  } catch (error) {
    if (error instanceof WorkshopError) throw error
    throw new WorkshopError('workshop-missing', `配置的车间目录不存在或不可访问：${dir}`)
  }
  return root
}

/** 车间内相对路径的安全拼接：拒绝越界（workshop-files.md 校验规则）。 */
export function workshopPath(root, rel) {
  const target = resolve(root, rel)
  const within = relative(root, target)
  if (within === '' || within.startsWith(`..${sep}`) || isAbsolute(within)) {
    throw new WorkshopError('bad-path', `路径越出车间根：${rel}`)
  }
  return target
}

/** 读取车间 JSON；文件缺失返回 null（空骨架由调用方决定），损坏抛 workshop-corrupt。 */
export async function readJson(root, rel) {
  const file = workshopPath(root, rel)
  let raw
  try {
    raw = await readFile(file, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return null
    throw new WorkshopError('read-failed', `读取 ${rel} 失败：${error.message}`, false)
  }
  try {
    return JSON.parse(raw)
  } catch {
    throw new WorkshopError('workshop-corrupt', `车间文件 ${rel} 不是合法 JSON，拒绝覆盖`, false)
  }
}

/** 原子写车间 JSON：同目录临时文件 + rename；Windows 覆盖前先删除目标。 */
export async function writeJson(root, rel, data) {
  const file = workshopPath(root, rel)
  const dir = dirname(file)
  await mkdir(dir, { recursive: true })
  // 临时文件必须与目标同目录（跨卷 rename 会 EXDEV）
  const tmp = join(dir, `.dsh-sm-tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  try {
    await rename(tmp, file)
  } catch (error) {
    // Windows：rename 不能覆盖已存在目标，先删除目标再 rename。
    if (process.platform === 'win32' && error && (error.code === 'EEXIST' || error.code === 'EPERM')) {
      await rm(file, { force: true })
      await rename(tmp, file)
    } else {
      await rm(tmp, { force: true })
      throw new WorkshopError('write-failed', `写入 ${rel} 失败：${error.message}`, false)
    }
  }
}

/** 目录是否存在。 */
export async function existsDir(path) {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/** 规范化路径段（供校验与展示）：去除 .. 与空段。 */
export function normalizeRel(rel) {
  return normalize(rel).replace(/^([/\\])+/, '').replace(/[/\\]+$/, '')
}
