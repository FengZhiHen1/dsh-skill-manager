// dsh-skill-manager — 进程内缓存层（延迟优化，插件运行时.md「低延迟路径」）。
//
// 三个缓存，全部以配置目录为事实边界：
// - bundle 缓存：library/groups/health/overview 共享的库快照（state/items/
//   groups/skills/workspace 投影），单飞冷扫、TTL 后失效、写操作后 refresh
//   预热——读请求在缓存热时零扫描零存储读。
// - meta 缓存：每个 skill 目录的 SKILL.md 解析结果，按 stat 签名
//   （mtimeMs:size）复用，重扫退化为 N 次 stat。
// - hash 缓存：dirHash 短 TTL（默认 5s），供 check 的本地修改展示用；
//   破坏性路径（update 判定本地修改）必须 fresh 强制重算；写操作统一清空。
//
// 一致性：读走冻结快照（同一引用永不撕裂）；写操作串行 + refresh 后缓存
// 才更新，UI 操作后的 reload 命中预热缓存。配置目录变更 → bundle 键失配
// → 自动冷扫。

/** 共享缓存句柄。 */
export function createSharedCache({ bundleTtlMs = 800, hashTtlMs = 5000 } = {}) {
  return {
    bundleTtlMs,
    hashTtlMs,
    // bundle 缓存（root 键 + TTL + 单飞）
    bundleRoot: null, // 快照对应的配置目录
    bundle: null, // { state, items, apps, groups, skills, workspaceProjects, legacyProjects, workspaceIds }
    bundleAt: 0,
    bundleInflight: null,
    // meta 缓存：`${root}\0${dir}` -> { sig, hasSkillMd, meta }
    meta: new Map(),
    // hash 缓存：dir -> { hash, at }
    hashes: new Map(),
    // health 代际缓存：随 bundle 引用失效（写后 refreshCache 换新引用即自然 miss）
    health: null, // { bundle, issues, at }
  }
}

/** 读取目录哈希缓存；未命中或过期返回 null。 */
export function cachedHash(shared, dir) {
  const hit = shared.hashes.get(dir)
  if (hit !== undefined && Date.now() - hit.at < shared.hashTtlMs) return hit.hash
  return null
}

/** 记录目录哈希（写操作后会清空整体哈希缓存）。 */
export function rememberHash(shared, dir, hash) {
  shared.hashes.set(dir, { hash, at: Date.now() })
}

/** 清空哈希缓存（任何写操作后调用，防破坏性路径读到陈旧基线）。 */
export function clearHashes(shared) {
  shared.hashes.clear()
}

/**
 * 构造 dirHash 的缓存门面：`hashOf(dir, { fresh })`。fresh=true 强制重算
 * （update 的本地修改判定）；默认先查短 TTL 缓存（check 的展示性判定）。
 */
export function hashOf(shared, dirHashFn) {
  return async (dir, { fresh = false } = {}) => {
    if (!fresh) {
      const hit = cachedHash(shared, dir)
      if (hit !== null) return hit
    }
    const hash = await dirHashFn(dir)
    rememberHash(shared, dir, hash)
    return hash
  }
}
