// dsh-skill-manager — 旧 storage 意图一次性迁移（插件运行时.md「迁移」）。
//
// 历史版本把用户意图（groups 表、mounts 表、skills 表的 disabled/group）存在
// storage 域。新架构意图唯一事实源是 settings 命名空间。本模块在启动时：
//   1. 用 legacySkillManagerSpec（旧七表）打开域，读存量意图；
//   2. 有数据且 settings 未标记 intentMigrated → scope.update 投影进配置；
//   3. 关闭旧域；随后 openStore 用新五表 spec 打开（version 相同，未声明表
//      被忽略；新 spec 的首次写入会把旧表从文件抹除，迁移自动幂等）。

import { legacySkillManagerSpec } from './storage.js'
import { DEFAULT_GROUP } from '../core/model/intent.js'

/**
 * 一次性迁移旧意图进 settings。
 * @param {object} ctx Host 上下文（注入 storage）
 * @param {import('@deepseek-ai/dsh-settings').SettingsScope} scope 已注册的配置 scope
 * @returns {Promise<boolean>} 是否执行了迁移写入
 */
export async function migrateLegacyIntent(ctx, scope, logger) {
  const current = scope.get()
  if (current.intentMigrated === true) return false
  let legacy
  try {
    legacy = await ctx.storage.domain.open(legacySkillManagerSpec)
  } catch (error) {
    logger?.warn?.(`dsh-skill-manager: 旧域读取失败，跳过意图迁移：${error?.message ?? String(error)}`)
    return false
  }
  try {
    // 直接访问 legacy 域表（新门面已不含旧表方法）。
    const mounts = () => [...legacy.table('mounts').entries()]
    const skillEntries = () => [...legacy.table('skills').entries()]
    // 挂载规则按组归集（仅 app=dsh；global 的 project 归一为 null）。
    const groups = {}
    for (const [, m] of mounts()) {
      if (m?.app !== 'dsh') continue
      if (!groups[m.group]) groups[m.group] = { mounts: [] }
      groups[m.group].mounts.push({ scope: m.scope, project: m.project ?? null })
    }
    // 虚拟默认组始终保留（无挂载则为空规则；种子挂载如有则已归集）。
    if (!groups[DEFAULT_GROUP]) groups[DEFAULT_GROUP] = { mounts: [] }
    // 技能意图：self 不迁移（不再登记）；其余按记录 disabled/group。
    const skills = {}
    for (const [dir, rec] of skillEntries()) {
      if (!rec || rec.origin === 'self') continue
      skills[dir] = {
        disabled: rec.disabled === true,
        group: typeof rec.group === 'string' && rec.group !== '' && rec.group !== DEFAULT_GROUP ? rec.group : DEFAULT_GROUP,
      }
    }
    const hasIntent = Object.keys(skills).length > 0 || Object.values(groups).some((g) => g.mounts.length > 0)
    if (!hasIntent) return false
    await scope.update({
      intentMigrated: true,
      ...(Object.keys(skills).length > 0 ? { skills } : {}),
      ...(Object.values(groups).some((g) => g.mounts.length > 0) ? { groups } : {}),
    })
    return true
  } finally {
    await legacy.close()
  }
}
