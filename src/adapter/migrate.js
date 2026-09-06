// migrate — 旧 storage 意图一次性迁移：读存量 → 投影进 settings → 标记完成。
//
// 边界：intentMigrated 已为 true 即整体跳过，重复启动幂等。
// 时序：必须先于 openStore——新旧 spec 同名，未声明的旧表由新 spec 首写抹除。
// 参考：目录配置与状态存储.md「旧意图迁移」。

import { legacySkillManagerSpec } from './storage.js'
import { DEFAULT_GROUP } from '../core/model/intent.js'

/**
 * 一次性迁移旧意图进 settings。
 * self 来源记录不进意图：本地 skill 无版本管理，也不登记。
 * @param {object} ctx Host 上下文，须注入 storage
 * @param {import('@deepseek-ai/dsh-settings').SettingsScope} scope 已注册的配置 scope
 * @param {{ warn?: Function }} [logger] 可选日志器，旧域打不开时只告警不外抛
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
