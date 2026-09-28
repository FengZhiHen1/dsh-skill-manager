// config-fields — 配置字段名与命名空间的**单一事实源**（浏览器安全：零 import）。
//
// 为什么单独成模块：这些名字同时被两处消费，而两处不能互相 import——
//   ① Host 侧 schema 与跨字段校验在 core/model/intent.js（读 node:fs/os/path，进不了浏览器）；
//   ② Client 配置页的字段规格在 core/model/page-specs.js（必须能进 client bundle）。
// 两边各写一份常量就是漂移源（改一处忘一处 = 配置页字段名与 schema 不匹配，且**不报错**，
// 只表现为该字段在页面上永远读不到值）。故名字归本模块，两处都从这里取。
// 参考：DSR-025。

/** 插件配置的命名空间名。
 * ⚠ 0.1.7 起命名空间 = 本行在 profile 中的 loader entry id（不再有插件自选名）。
 * 故本常量必须与 cordis.patch.yml 里 insert 行的 `id:` 逐字相同；改行 id 即换命名空间，
 * 会把配置页与本命名空间解绑。 */
export const CONFIG_NS = 'skill-manager'

/** 本地 skills 目录的配置键名；空串 = 未配置。 */
export const SKILLS_DIR_FIELD = 'skillsDir'

/** pi 接管开关的配置键名（布尔）；pi 目录固定按默认路径探测，不可配。 */
export const PI_FIELD = 'pi'

/** 虚拟默认组（不落配置也始终存在）。 */
export const DEFAULT_GROUP = '默认'
