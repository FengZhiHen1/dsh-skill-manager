// dsh-skill-manager — 文件系统与路径原语收口（base 层，DSR-015）。
// 搬位说明（P1）：safePath/existsDir/normalizeRel/writeJson 来自原 lib/dir.js；
// canonicalPath/pathsEqual/withinRoot/readLinkTarget 来自原 lib/sync.js。
// P2 新增：atomicSwapDir（写库目录一律原子换装，DSR-017）。

import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { mkdir, mkdtemp, readlink, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
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
 *
 * 悬挂回退的 8.3 归一：Windows 创建 junction 时目标被内核存成短路径形态
 * （如 `FENGZH~1`，实测 Node 24/readlink 如此返回），与 canonicalPath 得到
 * 的长路径前缀做 withinRoot 比对会误判非 owned——悬挂孤儿因此逃过清扫。
 * 对策：沿 readlink 结果向上找最近的存在祖先，realpath 展开为长形态后回填
 * 尾段，恢复可与长路径对比的规范目标。
 */
export async function readLinkTarget(path) {
  try {
    return await realpath(path)
  } catch {
    let raw
    try {
      raw = (await readlink(path)).replace(/^\\\\\?\\/, '')
    } catch {
      return ''
    }
    try {
      let cur = resolve(raw)
      const tail = []
      for (;;) {
        try {
          return join(await realpath(cur), ...tail.reverse())
        } catch {
          // cur 不存在：再向上走一层
        }
        const up = dirname(cur)
        if (up === cur) return raw
        tail.push(basename(cur))
        cur = up
      }
    } catch {
      return raw
    }
  }
}

/**
 * 原子换装（DSR-017/入站操作.md：写库目录一律"同卷临时目录构建 → rename
 * 交换"，不存在删旧后重写的半写窗口）。调用方负责先判定 dest 允许被本
 * 插件整体替换（update 目标必为自登记目录；add/restore 遇占位直接
 * name-conflict 拒绝，不走本函数）。
 *
 * 序列：mkdtemp(dest 同父目录) → buildFn(stage) 填充 → 旧 dest（如存在）
 * 整体改名移开 → 新目录顶上 → 删除旧目录。任何一步失败：已移开的旧目录
 * 放回原位，临时目录清理，抛出原错误——dest 全程要么是完整旧版要么是
 * 完整新版。
 */
export async function atomicSwapDir(dest, buildFn) {
  const parent = dirname(dest)
  await mkdir(parent, { recursive: true })
  const stage = await mkdtemp(join(parent, `.dsh-sm-swap-${basename(dest)}-`))
  const moved = join(parent, `.dsh-sm-old-${basename(dest)}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  let hadOld = false
  try {
    await buildFn(stage)
    try {
      await rename(dest, moved)
      hadOld = true
    } catch (error) {
      if (!(error && error.code === 'ENOENT')) throw error
    }
    try {
      await rename(stage, dest)
    } catch (error) {
      if (hadOld) await rename(moved, dest).catch(() => {})
      throw error
    }
    if (hadOld) await rm(moved, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } finally {
    await rm(stage, { recursive: true, force: true })
    if (hadOld) await rm(moved, { recursive: true, force: true }).catch(() => {})
  }
}
