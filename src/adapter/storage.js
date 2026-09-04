// dsh-skill-manager — storage 域 @deepseek-ai 包裹层（DSR-015 adapter 接缝）。
// defineDomain/domainTable 与 openStore 是全包唯一接触 @deepseek-ai/dsh-storage-domain
// 的地方（自原 lib/store.js 搬出，P1 搬位不改语义）；域形状与读写门面在
// core/model/store.js。

import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { buildLegacySkillManagerSpec, buildSkillManagerSpec, createStore } from '../core/model/store.js'

export const skillManagerSpec = buildSkillManagerSpec({ defineDomain, domainTable })

/** 旧七表 spec（含 groups/mounts 与带意图的 skills）——仅供一次性迁移读取存量意图。 */
export const legacySkillManagerSpec = buildLegacySkillManagerSpec({ defineDomain, domainTable })

/**
 * 在 Host apply 内打开域并返回门面；调用方负责把 close 挂进 ctx.effect。
 * @param {object} ctx Host 插件上下文（须注入 storage 服务）
 */
export async function openStore(ctx) {
  const domain = await ctx.storage.domain.open(skillManagerSpec)
  return createStore(domain)
}
