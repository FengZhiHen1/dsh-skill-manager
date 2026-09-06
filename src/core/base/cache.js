// cache — 进程内缓存：bundle 快照、SKILL.md 元数据、目录哈希三块。
//
// 边界：以配置目录为事实边界；读走冻结快照不撕裂，写后 refresh 才更新。
// 参考：插件运行时.md「请求调度与缓存」；DSR-013。

/**
 * 建共享缓存句柄：TTL 配置与两张 Map 的裸容器，跨端点共享一份。
 * bundleTtlMs 默认 800ms，hashTtlMs 默认 5000ms。
 * @param {{ bundleTtlMs?: number, hashTtlMs?: number }} [opts]
 */
export function createSharedCache({ bundleTtlMs = 800, hashTtlMs = 5000 } = {}) {
  return {
    bundleTtlMs,
    hashTtlMs,
    // bundle 缓存（root 键 + TTL + 单飞 + 代际守卫：写后 refresh 递进代际，迟到的旧冷扫不回写）
    bundleRoot: null, // 快照对应的配置目录
    bundle: null, // { root, items, skills, mounts, memberships, desired, warnings, workspacesById, workspacesView, links, mountRows, orphans }
    bundleAt: 0,
    bundleInflight: null,
    bundleGen: 0, // 写后刷新增一；冷扫写回时比对，防迟到旧扫描覆盖新快照
    // meta 缓存：`${root}\0${dir}` -> { sig, hasSkillMd, meta }，按 stat 签名复用
    meta: new Map(),
    // hash 缓存：dir -> { hash, at }
    hashes: new Map(),
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
 * 构造 dirHash 的缓存门面，形态为 hashOf(dir, { fresh })。
 * 默认先查短 TTL 缓存，命中即返回，供展示性判定使用。
 * fresh=true 绕过缓存强制重算，供 update 的本地修改判定使用。
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
