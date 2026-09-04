// dsh-skill-manager — 受信请求围栏（插件运行时.md：判定逻辑对齐
// dsh-better-sidebar 的受信请求围栏）。仅接受本机/受信权威 + 同源浏览器
// 标记的请求，其余一律 403。

function header(headers, name) {
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

function parseAuthority(authority) {
  try {
    return new URL(`http://${authority}`)
  } catch {
    return undefined
  }
}

/** hostname 是否指向本机回环。 */
export function isLoopbackHostname(hostname) {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return (
    parts.length === 4
    && parts[0] === '127'
    && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  )
}

function canonicalAuthority(entry, entryUrl) {
  const port = entryUrl.port !== '' ? entryUrl.port : new URL(`https://${entry}`).port
  return port === '' ? entryUrl.hostname : `${entryUrl.hostname}:${port}`
}

function isTrustedAuthority(hostUrl, trustedHosts) {
  return trustedHosts.some((entry) => {
    const entryUrl = parseAuthority(entry)
    if (entryUrl === undefined) return false
    return canonicalAuthority(entry, entryUrl) === entryUrl.hostname
      ? entryUrl.hostname === hostUrl.hostname
      : entryUrl.host === hostUrl.host
  })
}

/**
 * 判定一次请求是否可信。
 * @param {import('node:http').IncomingMessage} req
 * @param {string[]} trustedHosts - 非回环的受信权威（来自 connection 行的配置）。
 */
export function isTrustedApiRequest(req, trustedHosts) {
  const host = header(req.headers, 'host')
  if (host === undefined) return false
  const hostUrl = parseAuthority(host)
  if (hostUrl === undefined) return false
  if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false
  if (header(req.headers, 'sec-fetch-site') === 'cross-site') return false
  const origin = header(req.headers, 'origin')
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/** 从 loader 的 connection 行读取 trustedHosts；无 loader/行时为空列表。 */
export function trustedHostsOf(ctx) {
  try {
    for (const entry of ctx.loader.entries()) {
      if (entry.options.name === 'connection') {
        return entry.options.config?.trustedHosts ?? []
      }
    }
  } catch {
    // loader 缺失或不可用：仅回环判定。
  }
  return []
}
