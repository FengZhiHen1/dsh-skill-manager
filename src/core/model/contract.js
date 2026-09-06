// contract — Host↔Client RPC 载荷契约：每端点形状的运行时校验，单一事实源。
//
// 边界：零依赖纯 JS（client bundle 经 esbuild 打包本模块，不引 zod 以控制体积）；
// 校验不出副本，通过即返回原值。Host 在 dispatch 出站校验（钉住 Host 回归），
// Client 在 createCall 入站校验（脏数据落成显式错误态，不进渲染层）。
// 参考：插件运行时.md「RPC 传输」；DSR-014。

/** 契约违例：载荷形状与本模块声明不符；path 指明失配位置。 */
export class ContractError extends Error {
  /**
   * @param {string} path 失配字段路径（如 value.lib.skills[2].dir）
   * @param {string} expect 期望形状描述
   * @param {unknown} actual 实际值
   */
  constructor(path, expect, actual) {
    const got = actual === null ? 'null' : Array.isArray(actual) ? 'array' : typeof actual
    super(`RPC 载荷契约违例 @${path}：期望 ${expect}，实际 ${got}`)
    this.name = 'ContractError'
    /** 失配字段路径。 */
    this.path = path
  }
}

function need(cond, path, expect, actual) {
  if (!cond) throw new ContractError(path, expect, actual)
}

function needObj(v, path) {
  need(v !== null && typeof v === 'object' && !Array.isArray(v), path, 'object', v)
}

function needStr(v, path) {
  need(typeof v === 'string', path, 'string', v)
}

function needBool(v, path) {
  need(typeof v === 'boolean', path, 'boolean', v)
}

function needNum(v, path) {
  need(typeof v === 'number' && Number.isFinite(v), path, 'number', v)
}

function needStrOrNull(v, path) {
  need(v === null || typeof v === 'string', path, 'string|null', v)
}

function needBoolOrNull(v, path) {
  need(v === null || typeof v === 'boolean', path, 'boolean|null', v)
}

function needArr(v, path) {
  need(Array.isArray(v), path, 'array', v)
  return v
}

function needOneOf(v, path, allowed) {
  need(allowed.includes(v), path, allowed.join(' | '), v)
}

/** 可选字段：缺省（undefined）放行，存在则按 check 校验。 */
function opt(v, path, check) {
  if (v !== undefined) check(v, path)
}

/** 上游检查记录（check_cache 行 / overview 的 upstream 字段）。 */
function checkRecordShape(r, path) {
  needObj(r, path)
  needStr(r.checked_at, `${path}.checked_at`)
  needStr(r.repo, `${path}.repo`)
  needStrOrNull(r.branch, `${path}.branch`)
  needStrOrNull(r.current, `${path}.current`)
  needStrOrNull(r.latest, `${path}.latest`)
  needStr(r.status, `${path}.status`)
  needStrOrNull(r.reason, `${path}.reason`)
  needStrOrNull(r.via, `${path}.via`)
  needBool(r.updatable, `${path}.updatable`)
  needBool(r.reachable, `${path}.reachable`)
  needBoolOrNull(r.locally_modified, `${path}.locally_modified`) // 三态：null = 无基线不可判
  needBool(r.baseline_missing, `${path}.baseline_missing`)
  needBool(r.missing, `${path}.missing`)
}

function mountRowShape(row, path) {
  needObj(row, path)
  needStr(row.target, `${path}.target`)
  needStr(row.path, `${path}.path`)
  needStr(row.issue, `${path}.issue`)
}

function skillItemShape(it, path) {
  needObj(it, path)
  needStr(it.name, `${path}.name`)
  needStr(it.dir, `${path}.dir`)
  needStr(it.description, `${path}.description`)
  needOneOf(it.origin, `${path}.origin`, ['github', 'local', 'self'])
  needBool(it.hasSkillMd, `${path}.hasSkillMd`)
  needStrOrNull(it.commit, `${path}.commit`)
  needBool(it.missing, `${path}.missing`)
  needBool(it.disabled, `${path}.disabled`)
  needStr(it.group, `${path}.group`)
  needBool(it.nameVisible, `${path}.nameVisible`)
  needArr(it.targets, `${path}.targets`).forEach((t, i) => needStr(t, `${path}.targets[${i}]`))
  needArr(it.mount, `${path}.mount`).forEach((row, i) => mountRowShape(row, `${path}.mount[${i}]`))
  if (it.upstream !== null) checkRecordShape(it.upstream, `${path}.upstream`)
}

function workspaceShape(ws, path) {
  needObj(ws, path)
  needStr(ws.workspaceId, `${path}.workspaceId`)
  needStr(ws.title, `${path}.title`)
  needStr(ws.path, `${path}.path`)
  needNum(ws.mountCount, `${path}.mountCount`)
}

/** 对账结果（sync 返回值；add/update/restore 的 sync 字段同形）。 */
function syncResultShape(s, path) {
  needObj(s, path)
  needArr(s.results, `${path}.results`).forEach((r, i) => needObj(r, `${path}.results[${i}]`))
  needArr(s.warnings, `${path}.warnings`).forEach((w, i) => needStr(w, `${path}.warnings[${i}]`))
  needArr(s.errors, `${path}.errors`).forEach((e, i) => needObj(e, `${path}.errors[${i}]`))
}

/** check 结果项：skipped（不适用）只有三字段；其余状态带完整记录。 */
function checkItemShape(r, path) {
  needObj(r, path)
  needStr(r.name, `${path}.name`)
  needOneOf(r.status, `${path}.status`, ['skipped', 'updatable', 'up_to_date', 'check_failed'])
  needStrOrNull(r.reason ?? null, `${path}.reason`)
  if (r.status === 'skipped') return
  needStr(r.repo, `${path}.repo`)
  needStrOrNull(r.branch, `${path}.branch`)
  needStrOrNull(r.current, `${path}.current`)
  needStrOrNull(r.latest, `${path}.latest`)
  needStrOrNull(r.via, `${path}.via`)
  needBool(r.updatable, `${path}.updatable`)
  needBool(r.reachable, `${path}.reachable`)
  needBoolOrNull(r.locally_modified, `${path}.locally_modified`)
  needBool(r.baseline_missing, `${path}.baseline_missing`)
  needBool(r.missing, `${path}.missing`)
}

/** update 结果项：skipped = 不适用；failed = 执行失败（与 skipped 显式区分）；updated = 成功。 */
function updateItemShape(r, path) {
  needObj(r, path)
  needStr(r.name, `${path}.name`)
  needOneOf(r.status, `${path}.status`, ['skipped', 'updated', 'failed'])
  opt(r.reason, `${path}.reason`, needStr)
  opt(r.commit, `${path}.commit`, needStr)
  opt(r.via, `${path}.via`, needStrOrNull)
  opt(r.upToDate, `${path}.upToDate`, needBool)
  opt(r.registrationFailed, `${path}.registrationFailed`, needBool) // 换装成功但登记失败的显式漂移标记
}

const PARSERS = {
  overview(v, path) {
    needObj(v, path)
    needStr(v.root, `${path}.root`)
    needObj(v.lib, `${path}.lib`)
    needArr(v.lib.skills, `${path}.lib.skills`).forEach((it, i) => skillItemShape(it, `${path}.lib.skills[${i}]`))
    needArr(v.lib.warnings, `${path}.lib.warnings`).forEach((w, i) => needStr(w, `${path}.lib.warnings[${i}]`))
    needStrOrNull(v.lib.checkedAt, `${path}.lib.checkedAt`)
    needObj(v.health, `${path}.health`)
    needArr(v.health.issues, `${path}.health.issues`).forEach((issue, i) => {
      needObj(issue, `${path}.health.issues[${i}]`)
      needStr(issue.name, `${path}.health.issues[${i}].name`)
      needStr(issue.target, `${path}.health.issues[${i}].target`)
      needStr(issue.issue, `${path}.health.issues[${i}].issue`)
    })
    needArr(v.workspaces, `${path}.workspaces`).forEach((ws, i) => workspaceShape(ws, `${path}.workspaces[${i}]`))
  },
  warm(v, path) {
    needObj(v, path)
    needBool(v.ok, `${path}.ok`)
  },
  backups(v, path) {
    needArr(v, path).forEach((b, i) => {
      needObj(b, `${path}[${i}]`)
      needStr(b.id, `${path}[${i}].id`)
      needStr(b.name, `${path}[${i}].name`)
      needStr(b.time, `${path}[${i}].time`)
      needBool(b.has_meta, `${path}[${i}].has_meta`)
      needBool(b.meta_corrupt, `${path}[${i}].meta_corrupt`)
    })
  },
  search(v, path) {
    needObj(v, path)
    needStr(v.query, `${path}.query`)
    needNum(v.count, `${path}.count`)
    needArr(v.skills, `${path}.skills`).forEach((s, i) => {
      needObj(s, `${path}.skills[${i}]`)
      needStr(s.key, `${path}.skills[${i}].key`)
      needStr(s.name, `${path}.skills[${i}].name`)
      needStr(s.directory, `${path}.skills[${i}].directory`)
      needStr(s.repo, `${path}.skills[${i}].repo`)
      needNum(s.installs, `${path}.skills[${i}].installs`)
      needStr(s.url, `${path}.skills[${i}].url`)
    })
  },
  'repo-skills'(v, path) {
    needObj(v, path)
    needStr(v.repo, `${path}.repo`)
    needStr(v.branch, `${path}.branch`)
    needStr(v.commit, `${path}.commit`)
    needOneOf(v.via, `${path}.via`, ['api', 'zipball'])
    needArr(v.candidates, `${path}.candidates`).forEach((c, i) => {
      needObj(c, `${path}.candidates[${i}]`)
      needStr(c.path, `${path}.candidates[${i}].path`)
      needStr(c.name, `${path}.candidates[${i}].name`)
    })
  },
  add(v, path) {
    needObj(v, path)
    needStr(v.name, `${path}.name`)
    needStr(v.repo, `${path}.repo`)
    needStr(v.branch, `${path}.branch`)
    needStr(v.commit, `${path}.commit`)
    syncResultShape(v.sync, `${path}.sync`)
  },
  check(v, path) {
    needArr(v, path).forEach((r, i) => checkItemShape(r, `${path}[${i}]`))
  },
  update(v, path) {
    needObj(v, path)
    needArr(v.results, `${path}.results`).forEach((r, i) => updateItemShape(r, `${path}.results[${i}]`))
    if (v.sync !== null) syncResultShape(v.sync, `${path}.sync`)
  },
  remove(v, path) {
    needObj(v, path)
    needStr(v.name, `${path}.name`)
    needStrOrNull(v.backup, `${path}.backup`)
    needArr(v.detached, `${path}.detached`).forEach((d, i) => needStr(d, `${path}.detached[${i}]`))
  },
  restore(v, path) {
    needObj(v, path)
    needStr(v.name, `${path}.name`)
    if (v.sync !== null) syncResultShape(v.sync, `${path}.sync`)
  },
  sync: syncResultShape,
}

/**
 * 校验某端点的成功载荷；通过返回原值，失败抛 ContractError。
 * 端点不在契约表 = 装配错误，同样抛（dispatch 的 unknown-endpoint 门禁在先，这里双保险）。
 * @param {string} endpoint 端点名
 * @param {unknown} value 待校验载荷
 * @returns {unknown} 原值（校验不产生副本）
 * @throws {ContractError} 形状不符或端点未登记
 */
export function parseEndpointPayload(endpoint, value) {
  const parse = PARSERS[endpoint]
  if (!parse) throw new ContractError('value', '已登记端点', endpoint)
  parse(value, 'value')
  return value
}
