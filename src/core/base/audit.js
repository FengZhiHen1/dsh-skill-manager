// audit — 操作级审计台账：动手之前落 pending，动完补终态，只追加不改写。
//
// 边界：只记「改变文件系统现场」的操作，只读方法零记录；台账自身写失败绝不阻断业务，
//   降级为 logger.warn（首次一次）+ 失败计数，由批次出口把 audit-degraded 落进 results（不得静默）。
// 并发：同进程内所有行经单条 promise 链串行追加（防半行交错）；跨进程按 HOME 分文件天然隔离
//   ——两实例共用同一 HOME 属红线禁止（AGENTS.md Security），本层不设想跨进程并发写同一文件。
// 格式即接口（DSR-022 第 7 条）：一行一条完整 JSON，键名与键序冻结，绝对路径原样，不压缩不分片；
//   截断后仍是可 grep 的 .jsonl。缺省键写 null 而非省略，保证逐行同构。
// 参考：DSR-022「最终决定」1-9 条；docs/technical-details/挂载与同步.md「审计台账」。

import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

/** 台账行格式版本；键名或键序变更必须 +1 并在 DSR-022 登记（接口变更）。 */
export const AUDIT_SCHEMA = 1

/**
 * 冻结键序。actor 拆平为 entry/method（grep 友好优先于嵌套美观）；
 * 末四组是 summary/rotate 专用计数器，其余操作行里恒为 null。
 */
export const AUDIT_KEYS = Object.freeze([
  'schema', 'seq', 'ts', 'opId', 'phase', 'op', 'entry', 'method', 'home', 'profile', 'pid', 'procStarted',
  'skill', 'path', 'target', 'srcRoot', 'reason', 'configGen', 'result', 'code', 'error', 'durationMs',
  'evaluated', 'orphans', 'changed', 'dropped', 'kept',
])

const KEYS = AUDIT_KEYS

/** 操作类型全集；新增必须同步 DSR-022 第 4 条咽喉点清单与本枚举。 */
export const AUDIT_OPS = Object.freeze([
  'link-create', 'link-remove', 'mount-dir-create', 'exclude-write',
  'library-swap', 'library-remove', 'backup-create', 'backup-restore', 'backup-remove',
  'batch', 'rotate', 'adopt', 'audit-degraded',
])

const DEFAULT_MAX_LINES = 5000
const DEFAULT_MAX_AGE_DAYS = 90
const DAY_MS = 86_400_000

/** 单调短 id：pid 段保跨进程唯一，seq 段保进程内递增，rand 段抗同刻碰撞。 */
function opIdOf(pid, seq) {
  return `${pid.toString(36)}-${seq.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 建台账写入器。core 层，只依赖 node API（分层门禁允许）。
 *
 * @param {object} opts
 * @param {string} opts.file - 台账绝对路径（约定 $DSH_HOME/skill-manager/audit.jsonl）
 * @param {string|null} [opts.profile] - 归属 profile 名；平台未暴露时为 null（键仍在，日后填入不改格式）
 * @param {{warn?: Function}|null} [opts.logger] - 降级告警通道（ctx.logger 形状）
 * @param {number} [opts.maxLines] - 行数上限，超限保留最近 N 行
 * @param {number} [opts.maxAgeDays] - 天数上限，超龄行剔除
 * @param {() => number} [opts.now] - 时钟注入点（测试用，默认 Date.now）
 * @returns {{file: string, begin: Function, note: Function, endBatch: Function, failures: number}}
 */
export function createAudit({ file, profile = null, logger = null, maxLines = DEFAULT_MAX_LINES, maxAgeDays = DEFAULT_MAX_AGE_DAYS, now = Date.now } = {}) {
  const auditFile = resolve(file)
  // HOME 由台账路径反推（<HOME>/skill-manager/audit.jsonl），不依赖平台额外可读面。
  const home = resolve(auditFile, '..', '..')
  const pid = process.pid
  const procStarted = new Date(Date.now() - Math.round(process.uptime() * 1000)).toISOString()
  let seq = 0
  let failures = 0
  let warned = false
  let lines = 0
  // 单条串行链：并发 begin/note 的行按提交顺序落盘，绝不交错出半行。
  let chain = Promise.resolve()

  /** 按 KEYS 冻结键序成行：undefined → null（逐行同构），多余键丢弃。 */
  function serialize(base, extra) {
    // schema 由本层恒定注入（调用方不传，也不许传）：它是读取端判别键序版本的唯一依据。
    const merged = { schema: AUDIT_SCHEMA, ...base, ...extra }
    const out = {}
    for (const key of KEYS) out[key] = merged[key] === undefined ? null : merged[key]
    return JSON.stringify(out)
  }

  /** 追加一行（串行、失败降级）。@returns {Promise<boolean>} 是否落盘 */
  function append(line) {
    chain = chain.then(async () => {
      try {
        await mkdir(dirname(auditFile), { recursive: true })
        await appendFile(auditFile, `${line}\n`, 'utf8')
        lines += 1
        return true
      } catch (error) {
        failures += 1
        if (!warned) {
          warned = true
          logger?.warn?.(`dsh-skill-manager: 审计台账写入失败（同类失败本次运行不再逐条告警，计数见对账结果）：${error instanceof Error ? error.message : String(error)}`)
        }
        return false
      }
    })
    return chain
  }

  /** 归因字段：每条都带，跨实例/跨进程可追。 */
  function identity(actor) {
    return { home, profile, pid, procStarted, entry: actor.entry ?? null, method: actor.method ?? null }
  }

  /**
   * 开启一次操作：pending 落盘后才返回——这就是「先落盘、后动手」，
   * 进程在副作用中途被杀会留下无终态的 pending，它本身就是证据。
   * @returns {Promise<{opId: string, done: Function, fail: Function}>}
   */
  async function begin({ op, actor = {}, skill = null, path = null, target = null, srcRoot = null, reason = null, configGen = null } = {}) {
    seq += 1
    const id = opIdOf(pid, seq)
    const openedAt = now()
    const base = { ...identity(actor), opId: id, op, skill, path, target, srcRoot, reason, configGen }
    await append(serialize(base, { seq, ts: new Date(openedAt).toISOString(), phase: 'pending' }))
    const settle = (phase, patch) => append(serialize(base, {
      seq: (seq += 1),
      ts: new Date(now()).toISOString(),
      phase,
      durationMs: Math.max(0, now() - openedAt),
      ...patch,
    }))
    return {
      opId: id,
      /** 成功终态。patch 可带 result（默认 'ok'）等操作特有字段。 */
      done: (patch = {}) => settle('done', { result: 'ok', ...patch }),
      /** 失败终态：携错误码与消息——失败也必须有痕迹。 */
      fail: (error, patch = {}) => settle('failed', {
        result: 'error',
        code: error && typeof error === 'object' && 'code' in error ? String(error.code) : null,
        error: error instanceof Error ? error.message : (error === null || error === undefined ? null : String(error)),
        ...patch,
      }),
    }
  }

  /**
   * 单段记录（批次摘要 / 截断自证 / 归属认领）。无 pending 配对。
   * @returns {Promise<boolean>} 是否落盘
   */
  function note({ op, actor = {}, result = 'ok', reason = null, configGen = null, ...rest } = {}) {
    seq += 1
    const phase = op === 'rotate' ? 'rotate' : op === 'adopt' ? 'adopt' : 'summary'
    return append(serialize({ ...identity(actor), opId: opIdOf(pid, seq), op, result, reason, configGen }, {
      seq,
      ts: new Date(now()).toISOString(),
      phase,
      ...rest,
    }))
  }

  /**
   * 双上限截断（第 9 条）：> maxLines 或 > maxAgeDays 先到者生效；临时文件 + rename 原子替换，
   * 成功后补一条 rotate——否则台账出现无法解释的空洞。批次结束调用，不逐行重排。
   * 截断失败一律保留原文件（宁可不截，不可丢证据）。
   */
  async function maybeRotate() {
    let text
    try {
      text = await readFile(auditFile, 'utf8')
    } catch {
      lines = 0
      return { truncated: false, dropped: 0, kept: 0 } // 台账尚未生成：无可截断
    }
    const all = text.split('\n').filter((l) => l.trim() !== '')
    const cutoff = now() - maxAgeDays * DAY_MS
    const byAge = []
    for (const line of all) {
      let ts = Number.NaN
      try {
        ts = Date.parse(JSON.parse(line).ts)
      } catch {
        ts = Number.NaN // 不可解析的行保留：接口违例该由人发现，不由本层悄悄删
      }
      if (Number.isNaN(ts) || ts >= cutoff) byAge.push(line)
    }
    // 上限留一行给 rotate 自证：截断后总行数恒 ≤ maxLines（否则每次截断都反增一行）。
    const cap = Math.max(1, maxLines - 1)
    const kept = byAge.length > cap ? byAge.slice(-cap) : byAge
    lines = kept.length
    if (kept.length === all.length) return { truncated: false, dropped: 0, kept: kept.length }
    const tmp = join(dirname(auditFile), `.dsh-sm-audit-${pid}-${Date.now()}.tmp`)
    try {
      await writeFile(tmp, `${kept.join('\n')}\n`, 'utf8')
      await rename(tmp, auditFile)
    } catch (error) {
      failures += 1
      logger?.warn?.(`dsh-skill-manager: 审计台账截断失败（保留原文件，未丢弃任何记录）：${error instanceof Error ? error.message : String(error)}`)
      return { truncated: false, dropped: 0, kept: lines }
    }
    const dropped = all.length - kept.length
    await note({ op: 'rotate', reason: `双上限截断（≤${maxLines} 行 / ≤${maxAgeDays} 天）`, dropped, kept: kept.length })
    lines = kept.length + 1 // rotate 行自身已落盘
    return { truncated: true, dropped, kept: kept.length }
  }

  return {
    /** 台账绝对路径（诊断与 results 展示用）。 */
    file: auditFile,
    begin,
    note,
    /**
     * 批次出口：等在途行落定 → 跑截断检查 → 回报降级计数。
     * 调用方据此决定是否往 results 追加 audit-degraded 行（可见性归调用方，本层不外抛）。
     * @returns {Promise<{failures: number, truncated: boolean, file: string}>}
     */
    async endBatch() {
      await chain
      const { truncated } = await maybeRotate()
      await chain
      return { failures, truncated, file: auditFile }
    },
    /** 累计写入/截断失败数。 */
    get failures() {
      return failures
    },
  }
}
