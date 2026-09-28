// verdict — settings 写后裁定（纯函数，浏览器安全：零 import，可被 client bundle 打包）。
//
// 边界：本模块刻意独立于 model/intent.js——后者读文件系统（node:fs/os/path），进不了浏览器产物；
// 裁定逻辑则是 Client 半区的判据，两者必须在不同模块里，否则 client 构建直接失败。
// 参考：DSR-024（写后裁定以 Host 权威值为准）。

/**
 * 规范化字符串化（对象键排序、数组保序），供写后等值比较使用。
 * 刻意不用裸 JSON.stringify：它对键序敏感，Host 回传的 resolved 值与写入值只差键序时
 * 会被判成"未生效"，而写入值的键序不受插件控制——这个失败模式必须消掉。
 */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const body = Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    return `{${body.join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

/**
 * 写后裁定：一次字段写是否已被 Host 接受。判据是 Host 的权威值，**不是**浏览器镜像快照。
 * 为什么不能拿镜像判定：共享表单只把"最新一笔写"的回执折进镜像，被后续写超越的那一笔不回折
 * 视图（0.1.7 对应物 = `packages/client/ui-settings/src/client/config-form.ts` 的
 * `ConfigFormController.mutate`：`if (!response.ok) { await this.recover(generation); return false }`，
 * 即拒绝只折成 false + 一次恢复读，原因不外透），而删组/改名一次操作连发 groups+skills 两笔写
 * ——第一笔由此必然读到落后快照。
 * 2026-09-14 现场实证：写入已落盘（配置与对账台账均变），界面却报「被拒绝，已恢复原值」，
 * 修复提示词还把人引向"组名非法"（该值经插件自身 schema+validate 复核完全合法）。
 * 0.1.7 又添一条同向理由：`internal/config` 拒绝的候选由 loader 记 warn 并**保留原引用**，
 * 而 profile patch 此时已落盘——正是"持久层已写、运行期未生效"，只有权威读能抓到。
 * @param {unknown} attempted 尝试写入的字段值
 * @param {unknown} authoritative Host 权威值；undefined = 读不到（不猜"被拒"，回落 unknown）
 * @returns {'accepted'|'not-applied'|'unknown'} 已被接受 / 未生效 / 无法裁定
 */
export function writeVerdict(attempted, authoritative) {
  if (authoritative === undefined) return 'unknown'
  return canonicalJson(attempted) === canonicalJson(authoritative) ? 'accepted' : 'not-applied'
}
