// registry — 挂载归属登记表（storage 域 managed_links）：摘除权的来源（前缀只是下界，见 inspect.findOrphanLinks）。
// 唯一例外是出库摘链——用户指名且只删指向本次被删目录的链接，不以登记为前置（DSR-022 R9 ②）。
//
// 边界：只做「键归一 + 读集 + 写/删 + 可用性与失败计数」；不做任何 fs 动作，也不判定孤儿
//   （编排在 reconcile，现场扫描在 inspect）。
// 可用性（DSR-022 第 13 条）：整张表读不出来 → available=false，调用方必须**零摘除 + 零认领**；
//   单条写失败只计数（宁可残留：绝不因登记失败回滚已成功的链接动作，也不静默——计数进对账结果）。
// 参考：DSR-022 第 10/11/13 条与 R9；目录配置与状态存储.md「managed_links 表」。

import { resolve } from 'node:path'

/**
 * 登记键归一：绝对化 + 小写（Windows 路径不区分大小写）。
 * 与 inspect.js 期望集键（resolve(...).toLowerCase()）同构，使台账 path、表键、现场扫描三者可 JOIN。
 */
export function managedKey(path) {
  return resolve(path).toLowerCase()
}

/**
 * 建登记表门面。store 为 core/model/store.js 的窄门面（测试注入内存假域，同一契约）。
 * @param {{ store: object, now?: () => Date }} opts
 */
export function createLinkRegistry({ store, now = () => new Date() } = {}) {
  let keys = new Set()
  let available = false
  let loaded = false
  let failures = 0

  return {
    /** 整表读入（一趟对账一次）；读失败置 available=false 且不抛——降级由调用方报告。 */
    async load() {
      try {
        keys = new Set(store.linkEntries().map(([key]) => key))
        available = true
      } catch {
        keys = new Set()
        available = false
      }
      loaded = true
      return { available, size: keys.size }
    },
    get available() {
      return available
    },
    get loaded() {
      return loaded
    },
    /** 登记写入/删除的失败次数（>0 由对账报 registry-degraded）。 */
    get failures() {
      return failures
    },
    size: () => keys.size,
    /** 该链接是否已登记（摘除权的唯一问题）。 */
    has: (path) => keys.has(managedKey(path)),
    /** 建链或认领后登记；失败计数并返回 false（现场动作不回滚）。 */
    async register({ path, target, skill, opId = null }) {
      const key = managedKey(path)
      try {
        await store.putLink(key, { target: target ?? null, skill, created_at: now().toISOString(), op_id: opId })
        keys.add(key)
        return true
      } catch {
        failures += 1
        return false
      }
    },
    /** 摘链后销登记；表内本无此键也视为成功（幂等）。 */
    async unregister(path) {
      const key = managedKey(path)
      try {
        await store.deleteLink(key)
        keys.delete(key)
        return true
      } catch {
        failures += 1
        return false
      }
    },
  }
}
