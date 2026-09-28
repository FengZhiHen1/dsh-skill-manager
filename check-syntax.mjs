// check-syntax — 递归对 src 下全部 .js 文件跑 node --check（新文件不再漏进门禁）。
// .jsx 由 esbuild 构建面覆盖语法（build-client.mjs --check 的产物比对隐含解析）。
// 用法：node check-syntax.mjs（任一文件语法错误即非零退出）

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(p)
    else if (entry.name.endsWith('.js')) yield p
  }
}

let failed = 0
const targets = [...walk(join(here, 'src'))]
// dist/client.js 存在时也校验（宿主加载的产物本体）
const distClient = join(here, 'dist', 'client.js')
if (existsSync(distClient)) targets.push(distClient)
for (const file of targets) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
  } catch (error) {
    failed = 1
    console.error(`✗ ${file}\n${error.stderr?.toString() ?? error.message}`)
  }
}

// 注：块注释提前终止守卫（2026-09-28 实测事故）由仓库级 `tools/plugin-layering-check.mjs`
// 的 R3 规则承担——它扫全部插件、覆盖 .js/.jsx/.ts/.tsx，且已由 `npm run layering` 纳入本
// 脚本之后的门禁链。此处**不再重复实现**（同一规则两份实现 = 漂移源）。

if (failed === 0) console.log('✓ src 全部 .js 语法检查通过')
process.exit(failed)
