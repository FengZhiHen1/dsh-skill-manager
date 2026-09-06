// fsys — 文件系统与路径原语：越界解析、原子写、原子换装、链接归属判定。
//
// 边界：只承载 fs/路径原语，不含库语义；写库目录一律走 atomicSwapDir。
// 参考：DSR-015、DSR-017；入站操作.md。

import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { mkdir, mkdtemp, readlink, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { SkillManagerError } from './errors.js'

/**
 * 解析 root 之下的相对路径，拒绝越界与指向 root 自身。
 * @throws {SkillManagerError} bad-path — rel 解析后越出 root 或等于 root
 */
export function safePath(root, rel) {
  const target = resolve(root, rel)
  const within = relative(resolve(root), target)
  if (within === '' || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) {
    throw new SkillManagerError('bad-path', `路径越出 skills 目录：${rel}`, false, [
      { label: 'skills 目录', value: resolve(root) },
      { label: '被解析路径', value: String(rel) },
    ])
  }
  return target
}

/**
 * 判断路径存在且为目录。
 * 边界：任何 stat 失败一律 false，调用方按非目录处理。
 */
export async function existsDir(path) {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/** 归一相对路径：去掉首尾分隔符，用于校验与展示。 */
export function normalizeRel(rel) {
  return normalize(rel).replace(/^([/\\])+/, '').replace(/[/\\]+$/, '')
}

/**
 * 原子写 JSON：同目录临时文件 + rename 落位。
 * @throws {SkillManagerError} bad-path — rel 越出 root，由 safePath 透传
 * @throws {SkillManagerError} write-failed — 临时文件或 rename 失败，携目标路径 facts
 */
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
      // Windows 的 rename 不能覆盖已存在的目标：先删再rename，两步之间不留旧文件。
      if (process.platform === 'win32' && error && (error.code === 'EEXIST' || error.code === 'EPERM')) {
        await rm(file, { force: true })
        await rename(tmp, file)
      } else {
        throw error
      }
    }
  } catch (error) {
    await rm(tmp, { force: true })
    throw new SkillManagerError('write-failed', `写入 ${rel} 失败：${error instanceof Error ? error.message : String(error)}`, false, [
      { label: '目标文件', value: String(file) },
    ])
  }
}

/** realpath 规范化，消解 8.3 短路径；失败回退 resolve。 */
export async function canonicalPath(path) {
  try {
    return await realpath(path)
  } catch {
    return resolve(path)
  }
}

/** 路径相等判断：Windows 不区分大小写。任一入参为空串则永不相等。 */
export function pathsEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a === '' || b === '') return false
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

/**
 * 判断 target 是否严格位于 root 之内。
 * 有分隔符边界：只共享字符串前缀的兄弟路径不算在内，如 skills-sibling。
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
 * 读取链接目标：realpath 优先，悬挂链接回退 readlink 取原始目标串。
 * 全部失败返回空串，调用方据此判目标不可知——本函数不抛错。
 * why 回退需归一 8.3：Windows 建 junction 时目标被内核存成短路径形态，
 * 与 canonicalPath 的长路径前缀比对会误判非 owned，悬挂孤儿因此逃过清扫。
 * 对策：沿 readlink 结果向上找最近的存在祖先，realpath 展开后回填尾段。
 * 现场：短名形态如 FENGZH~1，Node 24 的 readlink 实测如此返回。
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
        } catch { // quality-floor: ignore silent-catch 逐级存在性探测：realpath 失败=「该层不存在」的预期信号，继续上走，全程失败回退 raw
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
 * 原子换装目录：新版本构建完成后整体替换 dest，不留半写窗口。
 * 序列：mkdtemp 于 dest 同父目录 → buildFn 填充 stage → 旧 dest 改名移开
 * → stage 顶上 → 删除移开的旧目录。
 * 失败：buildFn 或移开失败时 dest 原状不动；顶上失败先把旧目录放回原位再抛错。
 * 唯一例外：放回原位也失败时不删任何内容，旧版完整留在移开位置。
 * 该位置的绝对路径随错误一起进 facts，由人工处置——绝不当垃圾清理。
 * 调用方须先判定 dest 允许被本插件整体替换：update 目标必为自登记目录。
 * add/restore 遇占位直接 name-conflict 拒绝，不走本函数。
 * @throws {SkillManagerError} buildFn 抛出的业务错误原样透传
 * @throws {SkillManagerError} write-failed — 纯 fs 失败，携目标路径 facts
 */
export async function atomicSwapDir(dest, buildFn) {
  try {
    await swapDirInner(dest, buildFn)
  } catch (error) {
    // 业务错误（buildFn 抛出的 target-occupied/no-skill-md 等）与回滚告警
    // 已是 SkillManagerError，原样透传；纯 fs 失败归 write-failed 并带目标路径。
    if (error instanceof SkillManagerError) throw error
    throw new SkillManagerError(
      'write-failed',
      `原子换装 ${dest} 失败：${error instanceof Error ? error.message : String(error)}`,
      false,
      [{ label: '目标目录', value: dest }],
    )
  }
}

async function swapDirInner(dest, buildFn) {
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
      // 回滚内部失败会抛带保留位置的 write-failed，取代本次换装错误。
      if (hadOld) await restoreMovedOld(dest, moved)
      throw error
    }
    if (hadOld) await rm(moved, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } finally {
    // 只清 stage：旧目录在失败路径上一律保留，唯一删除点是上方的换装成功后置。
    await rm(stage, { recursive: true, force: true })
  }
}

/**
 * 把移开的旧目录放回 dest；放回失败时旧版是唯一残存副本，绝不删除。
 * @throws {SkillManagerError} write-failed — 复位失败，facts 含旧版保留位置
 */
async function restoreMovedOld(dest, moved) {
  try {
    await rename(moved, dest)
  } catch (rollbackError) {
    const detail = rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
    throw new SkillManagerError(
      'write-failed',
      `原子换装回滚失败，旧版完整保留在 ${moved}，请人工确认后再处理：${detail}`,
      false,
      [
        { label: '目标目录', value: dest },
        { label: '旧版保留位置', value: moved },
        { label: '回滚错误', value: detail },
      ],
    )
  }
}
