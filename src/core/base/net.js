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
 * 网络错误分类：repo-not-found / rate-limited / unreachable / repo-http-error。
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
 * why 超时归 unreachable：AbortSignal.timeout 的 AbortError 同样落到本函数；
 * 本通道全是幂等 GET（探测/下载），超时重试无重复效果，显式按「可重试失败」处理。
 * 呈现侧不得谎称「未送达」——Host 是否收到不可知（见 client repair.jsx 文案）。
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
    if (response.status === 404) throw new GhError('repo-not-found', '仓库或分支不存在')
    if (response.status === 403 && response.headers.get('X-RateLimit-Remaining') === '0') {
      throw new GhError('rate-limited', 'GitHub API 限流（匿名 60 次/小时/IP）')
    }
    throw new GhError('repo-http-error', `GitHub 返回 HTTP ${response.status}`)
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
 * @param {string} repoSlug owner/repo
 * @param {string} branch 分支名
 * @param {{ lsRemote?: (repo: string, branch: string) => Promise<string|null> }} [deps]
 *        测试注入点：替代 git 子进程回退通道
 * @returns {{sha: string|null, status: 'ok'|'repo-not-found'|'rate-limited'|'unreachable', via: 'api'|'ls-remote'|null, reason: string}}
 */
export async function remoteHead(repoSlug, branch, deps = {}) {
  const probeLsRemote = deps.lsRemote ?? lsRemote
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
  const sha = await probeLsRemote(repoSlug, branch)
  if (sha) return { sha, status: 'ok', via: 'ls-remote', reason: '' }
  if (kind === 'rate-limited') return { sha: null, status: 'rate-limited', via: null, reason: `${reason}，稍后重试` }
  if (kind === 'repo-not-found') return { sha: null, status: 'repo-not-found', via: null, reason: '仓库或分支不存在（上游改名/删除？）' }
  return { sha: null, status: 'unreachable', via: null, reason: `${reason}；git 回退亦不可达` }
}

/**
 * 按 branch → main → master 回退解析远端 commit。
 * @param {string} repoSlug owner/repo
 * @param {string} branch 首选分支
 * @param {{ lsRemote?: (repo: string, branch: string) => Promise<string|null> }} [deps] 测试注入点
 * @throws {SkillManagerError} remote-unreachable（可重试）— 三个候选分支均不可达
 */
export async function resolveRemote(repoSlug, branch, deps = {}) { // quality-floor: ignore docstring-promise 函数体确有 throw SkillManagerError（remote-unreachable）；扫描器将参数默认值花括号误作函数体起点致漏看
  let lastReason = ''
  for (const candidate of [...new Set([branch, 'main', 'master'])]) {
    const head = await remoteHead(repoSlug, candidate, deps)
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
 * why 逐段校验：GitHub 用户名只含字母数字与连字符；仓库名可含点（如 foo/bar.js），
 * 但单独成段的 '.'/'..' 在 URL 路径里有归位语义，必须拒绝。
 * @throws {SkillManagerError} bad-repo — 归一后仍不满足 owner/repo 文法
 */
export function normalizeRepoSlug(slug) {
  let out = String(slug ?? '').trim()
  out = out.replace(/\.git$/, '').replace(/\/+$/, '')
  out = out.replace(/^https?:\/\/github\.com\//, '')
  const parts = out.split('/')
  const valid = parts.length === 2
    && /^[A-Za-z0-9-]+$/.test(parts[0])
    && /^[\w.-]+$/.test(parts[1])
    && parts[1] !== '.' && parts[1] !== '..'
  if (!valid) {
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
  // 第三方响应逐字段归一（CORE-04 数据边界）：缺 id 以 repo#目录合成稳定 key，
  // 缺名字回落仓库名；保证下游契约（contract.js search 形状）不被上游脏数据击破。
  for (const s of data.skills ?? []) {
    const source = String(s.source ?? '')
    const parts = source.split('/', 2)
    // 过滤非 GitHub 来源：两段式 owner/repo，文法与 normalizeRepoSlug 同源
    // （owner 无点；repo 可含点但不得为 '.'/'..'；段内带点的首段是域名形态）。
    if (parts.length !== 2 || !/^[A-Za-z0-9-]+$/.test(parts[0]) || !/^[\w.-]+$/.test(parts[1]) || parts[1] === '.' || parts[1] === '..') continue
    const directory = typeof s.skillId === 'string' ? s.skillId : ''
    results.push({
      key: typeof s.id === 'string' && s.id !== '' ? s.id : `${source}#${directory}`,
      name: typeof s.name === 'string' && s.name !== '' ? s.name : source,
      directory,
      repo: source,
      installs: typeof s.installs === 'number' && Number.isFinite(s.installs) ? s.installs : 0,
      url: `https://github.com/${source}`,
    })
  }
  return {
    query: typeof data.query === 'string' ? data.query : query,
    count: typeof data.count === 'number' ? data.count : results.length,
    skills: results,
  }
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
