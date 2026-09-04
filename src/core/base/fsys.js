// dsh-skill-manager — 文件系统与路径原语收口（base 层，DSR-015）。
// 搬位说明（P1）：safePath/existsDir/normalizeRel/writeJson 来自原 lib/dir.js；
// canonicalPath/pathsEqual/withinRoot/readLinkTarget 来自原 lib/sync.js。
// 全部函数逻辑原样未动。

import { mkdir, readlink, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { SkillManagerError } from './errors.js'

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

/** realpath 规范化（8.3 短路径问题），失败回退 resolve。 */
export async function canonicalPath(path) {
  try {
    return await realpath(path)
  } catch {
    return resolve(path)
  }
}

/** 路径相等判断：Windows 不区分大小写。空串永不相等。 */
export function pathsEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a === '' || b === '') return false
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

/**
 * target 是否严格位于 root 之内。带路径分隔符边界：`skills-sibling/x`
 * 这类共享字符串前缀的兄弟路径不算在内（relative 结果不以 .. 逃逸为准）。
 */
export function withinRoot(root, target) {
  if (typeof root !== 'string' || typeof target !== 'string' || root === '' || target === '') return false
  let r = resolve(root)
  let t = resolve(target)
  if (process.platform === 'win32') {
    r = r.toLowerCase()
    t = t.toLowerCase()
  }
  const rel = relative(r, t)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

/**
 * 读取链接目标：realpath 优先；悬挂链接（目标已删除）回退 readlink 取原始
 * 目标串（剥除 Windows verbatim 前缀），供归属判断使用。全部失败返回 ''。
 */
export async function readLinkTarget(path) {
  try {
    return await realpath(path)
  } catch {
    try {
      const raw = await readlink(path)
      return raw.replace(/^\\\\\?\\/, '')
    } catch {
      return ''
    }
  }
}
