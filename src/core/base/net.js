// dsh-skill-manager — GitHub / skills.sh 网络通道（对齐 distributor net.py 语义）。
// 分支解析：GitHub API 主路径，失败回退 git ls-remote（入站操作.md）。

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** git ls-remote 回退通道：解析远端分支 sha；失败返回 null（不抛错，由调用方归类）。 */
async function lsRemote(repoSlug, branch) {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['ls-remote', `https://github.com/${repoSlug}.git`, `refs/heads/${branch}`],
      { timeout: 15000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
    )
    const sha = stdout.trim().split(/\s+/)[0]
    return sha || null
  } catch {
    return null
  }
}

const API = 'https://api.github.com'
const UA = { 'User-Agent': 'dsh-skill-manager', Accept: 'application/vnd.github+json' }
const TIMEOUT_MS = 15000
const DOWNLOAD_TIMEOUT_MS = 90000

/** 网络错误分类（入站操作.md）：not_found / rate_limited / unreachable / http_error。 */
export class GhError extends Error {
  kind
  constructor(kind, detail) {
    super(detail)
    this.name = 'GhError'
    this.kind = kind
  }
}

async function ghFetch(url, timeoutMs = TIMEOUT_MS) {
  let response
  try {
    response = await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeoutMs) })
  } catch (error) {
    throw new GhError('unreachable', `网络不可达: ${error.message}`)
  }
  if (!response.ok) {
    if (response.status === 404) throw new GhError('not_found', '仓库或分支不存在')
    if (response.status === 403 && response.headers.get('X-RateLimit-Remaining') === '0') {
      throw new GhError('rate_limited', 'GitHub API 限流（匿名 60 次/小时/IP）')
    }
    throw new GhError('http_error', `GitHub 返回 HTTP ${response.status}`)
  }
  return response
}

/** GET api.github.com{path} → JSON。 */
export async function ghApi(path) {
  const response = await ghFetch(`${API}${path}`)
  return response.json()
}

/** 下载二进制（zipball）。 */
export async function ghDownload(url) {
  const response = await ghFetch(url, DOWNLOAD_TIMEOUT_MS)
  return Buffer.from(await response.arrayBuffer())
}

/**
 * 上游分支最新 sha：API 主路径，失败回退 git ls-remote。
 * @returns {{sha: string|null, status: 'ok'|'not_found'|'rate_limited'|'unreachable', via: 'api'|'ls-remote'|null, reason: string}}
 */
export async function remoteHead(repoSlug, branch) {
  let kind = 'unreachable'
  let reason = ''
  try {
    const data = await ghApi(`/repos/${repoSlug}/branches/${branch}`)
    const sha = data?.commit?.sha
    if (sha) return { sha, status: 'ok', via: 'api', reason: '' }
    reason = 'API 响应缺少 commit.sha'
  } catch (error) {
    if (error instanceof GhError) {
      kind = error.kind
      reason = error.message
    } else {
      reason = String(error)
    }
  }
  const sha = await lsRemote(repoSlug, branch)
  if (sha) return { sha, status: 'ok', via: 'ls-remote', reason: '' }
  if (kind === 'rate_limited') return { sha: null, status: 'rate_limited', via: null, reason: `${reason}，稍后重试` }
  if (kind === 'not_found') return { sha: null, status: 'not_found', via: null, reason: '仓库或分支不存在（上游改名/删除？）' }
  return { sha: null, status: 'unreachable', via: null, reason: `${reason}；git 回退亦不可达` }
}

/** 按 branch → main → master 回退解析；全部失败抛 remote-unreachable。 */
export async function resolveRemote(repoSlug, branch) {
  for (const candidate of [...new Set([branch, 'main', 'master'])]) {
    const head = await remoteHead(repoSlug, candidate)
    if (head.sha) return { commit: head.sha, branch: candidate, via: head.via }
  }
  const head = await remoteHead(repoSlug, branch)
  throw new Error(
    `无法解析 ${repoSlug} 的分支（${[branch, 'main', 'master'].join('/')} 均不可达：${head.reason}）`,
  )
}

/** 仓库 slug 规范化与校验（目录配置与状态存储.md 校验规则）。 */
export function normalizeRepoSlug(slug) {
  let out = String(slug ?? '').trim()
  out = out.replace(/\.git$/, '').replace(/\/+$/, '')
  out = out.replace(/^https?:\/\/github\.com\//, '')
  if (!/^[\w.-]+\/[\w.-]+$/.test(out) || out.split('/').some((part) => part.includes('.'))) {
    throw new Error(`无效的仓库标识: ${slug}（应为 owner/repo）`)
  }
  return out
}

/** skills.sh 搜索（fetch.py search_skills_sh 语义，15 秒超时）。 */
export async function searchSkillsSh(query, limit = 20, offset = 0) {
  const params = new URLSearchParams({ q: query, limit: String(limit), offset: String(offset) })
  let response
  try {
    response = await fetch(`https://skills.sh/api/search?${params}`, {
      headers: { 'User-Agent': 'dsh-skill-manager' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    throw new Error(`skills.sh 搜索失败: ${error.message}`)
  }
  if (!response.ok) throw new Error(`skills.sh 搜索失败: HTTP ${response.status}`)
  const data = await response.json()
  const results = []
  for (const s of data.skills ?? []) {
    const source = String(s.source ?? '')
    const parts = source.split('/', 2)
    // 过滤非 GitHub 来源（两段均不含点）
    if (parts.length !== 2 || parts[0].includes('.') || parts[1].includes('.')) continue
    results.push({
      key: s.id,
      name: s.name,
      directory: s.skillId,
      repo: source,
      installs: s.installs ?? 0,
      url: `https://github.com/${source}`,
    })
  }
  return { query: data.query ?? query, count: data.count ?? 0, skills: results }
}

/** 下载并解压 zipball，返回顶层目录内全部文件（相对路径 → Buffer）。 */
export async function fetchZipball(repoSlug, branch) {
  const url = `https://github.com/${repoSlug}/archive/refs/heads/${branch}.zip`
  const payload = await ghDownload(url)
  return payload
}
