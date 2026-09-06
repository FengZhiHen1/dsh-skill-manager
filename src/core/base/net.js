// net — GitHub 与 skills.sh 网络通道：分支解析、zipball 下载、搜索。
//
// 边界：GitHub 通道失败抛 GhError，kind 即稳定错误码；语义失败抛 SkillManagerError。
// 调用方按码分流，不做文案匹配转译。
// 参考：入站操作.md「搜索与仓库探测」；DSR-003（参考基线）、DSR-015。

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { SkillManagerError } from './errors.js'

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

/**
 * 网络错误分类：not_found / rate_limited / unreachable / http_error。
 * kind 会被 toRpcFailure 直接当作稳定错误码。
 */
export class GhError extends Error {
  /** 稳定分类码，同时是 REPAIR_META 的键。 */
  kind

  /**
   * 构造一次网络分类错误。
   * @param {string} kind - 稳定分类码
   * @param {string} detail - 面向用户的中文失败描述
   */
  constructor(kind, detail) {
    super(detail)
    this.name = 'GhError'
    this.kind = kind
  }
}

/**
 * TLS 证书校验失败的 node/OpenSSL 错误码集。
 * 最常见诱因：本机 GitHub 加速或代理工具以自签 CA 替换证书。
 * 例：SteamTools、Clash 这类工具的 GitHub 加速功能。
 * git 通道经系统证书库信任它，node fetch 用自带 CA 列表、不读系统证书库。
 * 于是出现「check 正常、update/add 下载失败」的分裂现场。
 */
const TLS_CERT_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNKNOWN_CA',
  'INVALID_CA',
  'CERT_UNTRUSTED',
  'CERT_REJECTED',
])

/**
 * fetch 异常 → GhError 归类。
 * 证书类失败点破归因与对策，其余归 unreachable。
 */
export function classifyFetchError(error) {
  const code = error?.cause?.code
  if (typeof code === 'string' && TLS_CERT_CODES.has(code)) {
    return new GhError(
      'unreachable',
      `TLS 证书校验失败（${code}）：疑似本机 GitHub 加速/代理工具替换了证书（node 不读 Windows 系统证书库）。对策：给实例环境变量 NODE_EXTRA_CA_CERTS 指向该工具的根证书 PEM，或关闭其 GitHub 加速后重试。`,
    )
  }
  return new GhError('unreachable', `网络不可达: ${error.message}`)
}

async function ghFetch(url, timeoutMs = TIMEOUT_MS) {
  let response
  try {
    response = await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeoutMs) })
  } catch (error) {
    throw classifyFetchError(error)
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

/**
 * GET api.github.com{path} → JSON。
 * 失败由 ghFetch 抛 GhError，本函数不重新归类。
 */
export async function ghApi(path) {
  const response = await ghFetch(`${API}${path}`)
  return response.json()
}

/**
 * 下载二进制，例如 zipball。
 * 失败由 ghFetch 抛 GhError，本函数不重新归类。
 */
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

/**
 * 按 branch → main → master 回退解析远端 commit。
 * @throws {SkillManagerError} remote-unreachable（可重试）— 三个候选分支均不可达
 */
export async function resolveRemote(repoSlug, branch) {
  let lastReason = ''
  for (const candidate of [...new Set([branch, 'main', 'master'])]) {
    const head = await remoteHead(repoSlug, candidate)
    if (head.sha) return { commit: head.sha, branch: candidate, via: head.via }
    lastReason = head.reason
  }
  throw new SkillManagerError(
    'remote-unreachable',
    `无法解析 ${repoSlug} 的分支（${[branch, 'main', 'master'].join('/')} 均不可达：${lastReason}）`,
    true,
    [{ label: '仓库', value: repoSlug }],
  )
}

/**
 * 归一并校验仓库 slug，容忍 https 地址与 .git 后缀写法。
 * @throws {SkillManagerError} bad-repo — 归一后仍不满足 owner/repo 文法
 */
export function normalizeRepoSlug(slug) {
  let out = String(slug ?? '').trim()
  out = out.replace(/\.git$/, '').replace(/\/+$/, '')
  out = out.replace(/^https?:\/\/github\.com\//, '')
  if (!/^[\w.-]+\/[\w.-]+$/.test(out) || out.split('/').some((part) => part.includes('.'))) {
    throw new SkillManagerError('bad-repo', `无效的仓库标识: ${slug}（应为 owner/repo）`, false, [
      { label: '原始输入', value: String(slug ?? '') },
    ])
  }
  return out
}

/**
 * skills.sh 搜索：15 秒超时，只保留 GitHub 两段式来源的结果。
 * @throws {SkillManagerError} remote-unreachable — 请求失败或非 2xx
 */
export async function searchSkillsSh(query, limit = 20, offset = 0) {
  const params = new URLSearchParams({ q: query, limit: String(limit), offset: String(offset) })
  let response
  try {
    response = await fetch(`https://skills.sh/api/search?${params}`, {
      headers: { 'User-Agent': 'dsh-skill-manager' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    throw new SkillManagerError('remote-unreachable', `skills.sh 搜索失败: ${error.message}`, true, [
      { label: '查询词', value: String(query) },
    ])
  }
  if (!response.ok) {
    throw new SkillManagerError('remote-unreachable', `skills.sh 搜索失败: HTTP ${response.status}`, true, [
      { label: '查询词', value: String(query) },
    ])
  }
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

/**
 * 下载 zipball 二进制，只走 api.github.com 形态 URL。
 * why 不用主站 archive 形态：github.com:443 直连可持续 connect timeout，
 * 因为 undici 不随系统代理；而 api.github.com 全程可达。
 * 两种形态内容等价，同转 codeload，且与 check/探测共享已被实测的连通面。
 * 失败由 ghDownload 抛 GhError 透传，kind 是稳定分类。
 */
export async function fetchZipball(repoSlug, branch) {
  const url = `https://api.github.com/repos/${repoSlug}/zipball/${encodeURIComponent(branch)}`
  const payload = await ghDownload(url)
  return payload
}
