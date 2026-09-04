// dsh-skill-manager — 稳定的业务错误类型与修复提示词 facts（DSR-018）。
//
// 所有业务失败都抛出 SkillManagerError；service 的 dispatch 把任意错误翻译成
// 传输中立 Result：{ ok:false, error:{ code, message, details:{ retryable,
// repair } } }。repair = { operation, summary, facts, recommendation }——
// summary/recommendation 按 code 取本文件模板表，抛出点携带动态 facts
// （相关路径、条目现场），operation 由 dispatch 注入端点名。任何失败（含
// internal 兜底）都必须携带 repair；最终提示词文本由 Client 统一模板组装
// （P6）。未知异常归类 internal，不冒泡杀死 Host。

export class SkillManagerError extends Error {
  /** 稳定错误码（见 需求.md R-19 与 插件运行时.md 错误协议）。 */
  code
  /** 是否值得重试（网络类错误为 true）。 */
  retryable
  /**
   * 动态修复 facts（[{ label, value }]）：抛出点附带的现场信息（相关路径、
   * 条目名、配置值），与 code 模板在 buildRepair 合并。可缺省。
   */
  facts

  constructor(code, message, retryable = false, facts = []) {
    super(message)
    this.name = 'SkillManagerError'
    this.code = code
    this.retryable = retryable
    this.facts = facts
  }
}

/** 按错误码的 repair 模板（summary 一句人话；recommendation 有序步骤）。 */
export const REPAIR_META = {
  'skilldir-unconfigured': {
    summary: '尚未配置本地 skill 目录，管理功能整体不可用。',
    recommendation: [
      '打开 设置 → 插件 → skill-manager 卡片，填写本地 skill 目录的绝对路径并保存',
      '保存后重新打开技能页（配置保存即生效，无需重启）',
    ],
  },
  'skilldir-missing': {
    summary: '已配置的 skill 目录不存在或当前不可读。',
    recommendation: [
      '确认该路径是否被移动、改名或删除；目录确实丢失时先恢复或重建',
      '若目录已换位置，在设置卡片中更新 skillsDir 为新路径',
      '重新打开技能页验证',
    ],
  },
  'workspace-unavailable': {
    summary: '无法读取 DSH 工作区注册表，项目级挂载目标无法解析（本次操作未触碰任何项目目录）。',
    recommendation: [
      '稍后重试（注册表可能暂忙）',
      '持续失败时请本地 Agent 只读检查 DSH HOME 下的工作区登记数据是否损坏',
    ],
  },
  'bad-name': {
    summary: 'skill 安装名不满足命名文法（小写字母/数字/连字符），DSH 无法识别。',
    recommendation: ['把目录改名为形如 pdf-tools 的小写连字符形式后重试'],
  },
  'bad-path': {
    summary: '请求路径非法或越出配置目录边界。',
    recommendation: ['确认操作目标确实位于配置的 skills 目录内', '越界路径不要手工强填，改用设置卡片选目录'],
  },
  'bad-repo': {
    summary: '仓库格式非法（需要 owner/name）。',
    recommendation: ['按 owner/name 形式（如 anthropics/skills）修正后重试'],
  },
  'bad-group-name': {
    summary: '组名非法（空串、含保留分隔符或撞保留字）。',
    recommendation: ['改用普通中文名/字母名后重试'],
  },
  'bad-zipball': {
    summary: 'GitHub 下载的源码包解析失败。',
    recommendation: ['重试一次（上游归档偶发抖动）', '持续失败时改钉某个 commit 或换 ref 再试'],
  },
  'name-conflict': {
    summary: '库内已存在同名 skill。',
    recommendation: ['用「改名导入」提供新名', '或先出库旧条目（旧版内容会自动进备份区，可回滚）再导入'],
  },
  'needs-selection': {
    summary: '仓库含多个 skill，未指定要导入的目录。',
    recommendation: ['用「仓库探测」列出候选目录，选定 dir 后重试'],
  },
  'no-skill-md': {
    summary: '源目录缺少 SKILL.md，无法作为 skill 挂载。',
    recommendation: ['为该目录补齐 SKILL.md（含 name/description frontmatter）后刷新重试'],
  },
  'not-found': {
    summary: '操作目标不存在（可能被手工删除或名称有误）。',
    recommendation: ['核对条目名/路径；目录被误删时到备份区找同名时间戳快照恢复'],
  },
  'not-removable': {
    summary: '出库仅限外部来源（github）登记的 skill；自研/本地目录无删除入口。',
    recommendation: ['自管文件请直接在 skills 目录操作（DSH 直接识别真实目录）', '如确要插件接管，重新以 github 来源入库'],
  },
  'already-installed': {
    summary: '该仓库条目已登记，重复入库被拒绝。',
    recommendation: ['改用「检查更新」获取上游新版本', '确要重装：先出库原条目（自动备份）再添加'],
  },
  'path-stale': {
    summary: '登记记录与库内目录现状不一致（目录被移动或改名）。',
    recommendation: ['确认移动是否有意：有意则按新位置重新入库；无意则恢复原目录名后刷新'],
  },
  'remote-unreachable': {
    summary: '本地无法访问该 skill 的远端来源。',
    recommendation: ['检查网络/代理后重试', '离线场景请直接维护 skills 目录内的文件（无需插件通道）'],
  },
  'target-occupied': {
    summary: '挂载目标被非托管实体占用（真实目录或外来内容）；按只读红线插件不会触碰它。',
    recommendation: [
      '打开占用目录确认内容：若是旧版本复制物化的残留或一次性目录，自行备份后删除该目录',
      '刷新技能页触发对账，空闲目标将自动重建 junction',
      '若目录是有意保留的本地版本（遮蔽场景），可不处理——DSH 以项目内本地版为准',
    ],
  },
  'wrong-target': {
    summary: '挂载目标是链接但指向别处；指向库外的链接视为他人资产，不夺取。',
    recommendation: [
      '本库内旧链接（改名遗留）会在对账时自动摘除重建，无需人工',
      '指向库外的链接请先确认用途，确属残留再手工删除后刷新对账',
    ],
  },
  'write-failed': {
    summary: '文件写入/原子换装失败（权限、磁盘或占用）。',
    recommendation: ['检查目标目录写权限与磁盘空间', '关闭可能占用目标文件的进程（编辑器/同步盘）后重试'],
  },
  'local-changes-confirmation-required': {
    summary: '检测到与上游基线不一致的本地修改，更新被拦在显式确认门禁前。',
    recommendation: ['先 diff/备份本地修改', '确认后勾选「已保存本地修改」重试更新', '想长期保留本地版则不要更新该条目（可改为出库转自管）'],
  },
  // GhError 网络分类（base/net.js 的 kind 直通错误码）
  not_found: { summary: 'GitHub 上找不到该仓库/分支/路径。', recommendation: ['核对仓库名与 ref（默认 main）', '私有仓库需 GitHub 授权后重试'] },
  http_error: { summary: 'GitHub 返回异常 HTTP 状态。', recommendation: ['稍后重试', '持续失败查看 GitHub 状态页与仓库可见性'] },
  rate_limited: { summary: 'GitHub API 匿名限流（60 次/小时/IP）。', recommendation: ['等待约一小时后重试', '高频使用场景建议配置 GitHub token'] },
  unreachable: { summary: '无法访问 GitHub（网络或代理）。', recommendation: ['检查网络连接/代理设置后重试'] },
  'unknown-endpoint': {
    summary: '调用了未注册的插件端点（一般是客户端与 Host 版本不一致）。',
    recommendation: ['刷新页面重载客户端', '仍复现时核对 Host 与插件包版本'],
  },
}

/** 未分类异常（internal）与表外 code 的通用模板：保证任何失败都有复制入口。 */
const GENERIC_REPAIR = {
  summary: '插件执行失败（未分类错误），具体原因见错误消息。',
  recommendation: [
    '先原样重试一次（偶发失败可能自行恢复）',
    '仍失败时把本提示词交给本地 Agent：只读排查上下文涉及的路径与配置并给出修复方案；任何写操作须先向用户确认',
  ],
}

/**
 * 组装 repair facts（DSR-018）：code 模板 + 动态现场。operation 为端点名；
 * facts 保留抛出序（上下文清单）；表外 code 落通用模板。
 * @param {string} code - 稳定错误码
 * @param {{ operation?: string, facts?: Array<{label: string, value: string}> }} context
 */
export function buildRepair(code, { operation, facts = [] } = {}) {
  const meta = REPAIR_META[code] ?? GENERIC_REPAIR
  return {
    operation: operation ?? code,
    summary: meta.summary,
    facts: facts.filter((f) => f && typeof f.value === 'string' && f.value !== ''),
    recommendation: [...meta.recommendation],
  }
}

/** 未配置本地 skill 目录的统一错误（需求.md R-22）。 */
export const unconfigured = () =>
  new SkillManagerError(
    'skilldir-unconfigured',
    '尚未配置本地 skill 目录：请到 设置 → 插件 → skill-manager 卡片配置本地 skill 目录后使用。',
  )
