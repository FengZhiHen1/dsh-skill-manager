// dsh-skill-manager — git 通道（requirements.md R-18 / C-05）。
// 全部经系统 git 二进制子进程执行，`-C <root>` 定位车间；自动提交只作用于
// 约定路径（skills/、skills.lock.json、distributor/ 等），绝不 git add -A。
// 非 Git 车间：自动提交降级为跳过并提示（C-05）。

import { execFile } from 'node:child_process'

const GIT_TIMEOUT_MS = 30000

function runGit(root, args, timeoutMs = GIT_TIMEOUT_MS) {
  return new Promise((resolvePromise, reject) => {
    execFile(
      'git',
      ['-C', root, ...args],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr || stdout || error.message).trim()
          reject(new Error(`git ${args.join(' ')} 失败：${detail.slice(0, 500)}`))
          return
        }
        resolvePromise(stdout)
      },
    )
  })
}

/** 车间根是否 Git 仓库。 */
export async function isGitRepo(root) {
  try {
    await runGit(root, ['rev-parse', '--is-inside-work-tree'])
    return true
  } catch {
    return false
  }
}

/**
 * 提交约定路径（C-05）：git add <paths> 后仅在有暂存变更时提交。
 * @returns {Promise<boolean>} 是否实际产生了提交。
 */
export async function commitPaths(root, paths, message) {
  if (paths.length === 0) return false
  if (!(await isGitRepo(root))) {
    console.warn(`[skill-manager] 车间 ${root} 不是 Git 仓库，自动提交降级为跳过：${message}`)
    return false
  }
  try {
    await runGit(root, ['add', '--', ...paths])
  } catch (error) {
    console.warn(`[skill-manager] git add 失败：${error.message}`)
    return false
  }
  // diff --cached --quiet：有暂存变更时退出码 1（runGit 视作失败），无变更时 0。
  let staged = false
  try {
    await runGit(root, ['diff', '--cached', '--quiet'])
  } catch {
    staged = true
  }
  if (!staged) return false
  try {
    await runGit(root, ['commit', '-m', message, '--no-verify'])
    return true
  } catch (error) {
    console.warn(`[skill-manager] git commit 失败：${error.message}`)
    return false
  }
}

/** 目录级 git 指纹：`git log -1 --format=%H -- <rel>`；非 Git 或从未提交为 null。 */
export async function logHash(root, rel) {
  try {
    const out = await runGit(root, ['log', '-1', '--format=%H', '--', rel])
    const hash = out.trim()
    return hash === '' ? null : hash
  } catch {
    return null
  }
}

/** git ls-remote 单引用探测：返回 sha 或 null（net.js 分支回退通道）。 */
export function lsRemote(repoSlug, branch) {
  return new Promise((resolvePromise) => {
    execFile(
      'git',
      ['ls-remote', `https://github.com/${repoSlug}.git`, `refs/heads/${branch}`],
      { timeout: GIT_TIMEOUT_MS, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          resolvePromise(null)
          return
        }
        const sha = stdout.trim().split(/\s+/)[0]
        resolvePromise(sha || null)
      },
    )
  })
}
