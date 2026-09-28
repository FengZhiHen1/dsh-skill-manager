// client 产物「可加载性」冒烟：像宿主那样真的执行 dist/client.js 的 factory。
//
// 为什么需要这一层（2026-09-28 实测事故，DSR-027 附节）：
//   源码块注释提前终止泄漏出一条裸语句 `src;`。它是**合法语法**，于是三道既有闸门全过：
//   ① esbuild 正常产出；② `node --check` 通过；③ 产物新鲜度比对通过（源码与产物一致，只是都错）。
//   它只在**运行时**炸 `ReferenceError: src is not defined`，浏览器端表现为 `import failed`、
//   整个 Client 半区不加载。⇒ 「语法正确 / 产物新鲜」都不等于「能加载」，缺的正是本用例。
//
// 边界：只执行 factory 体（模块顶层与导出装配），**不调用 apply**（apply 需要真 ctx）。
// 宿主契约：产物包成 window.__ModuleLoader__.load({ id, factory: (require) => … })。
// React 由浏览器模块表在运行时提供，此处按 esbuild 的 __toESM 形状给最小替身。

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const BUNDLE = join(here, '..', 'dist', 'client.js')

/**
 * esbuild 的外部依赖替身。__toESM 会按「有 __esModule 就直接用，否则包一层」处理，
 * 故必须显式提供这些键（单纯用 Proxy 会被 __copyProps 拷成空对象 ⇒ 报 xxx is not a function）。
 */
function fakeReact() {
  const noop = () => null
  const hooks = {
    useState: (v) => [typeof v === 'function' ? v() : v, noop],
    useEffect: noop, useMemo: (f) => (typeof f === 'function' ? f() : undefined),
    useCallback: (f) => f, useRef: (v) => ({ current: v }),
    useContext: () => ({}), useReducer: (r, i) => [i, noop],
    useLayoutEffect: noop, useId: () => 'id',
  }
  return {
    __esModule: true,
    default: { createElement: noop, Fragment: 'Fragment' },
    createElement: noop, Fragment: 'Fragment', cloneElement: noop,
    jsx: noop, jsxs: noop, jsxDEV: noop,
    ...hooks,
  }
}

/** 最小 DOM/browser 面：模块顶层若触碰这些全局不至于炸；缺失探测（typeof x）应得 undefined。 */
function installGlobals() {
  const store = new Map()
  const saved = new Map()
  const g = globalThis
  // navigator 等内建全局在 Node 里是 **getter-only** 访问器（直接赋值抛 TypeError），
  // 故一律走 defineProperty 覆盖，并记录原描述符以便还原。
  const define = (key, value) => {
    saved.set(key, Object.getOwnPropertyDescriptor(g, key))
    Object.defineProperty(g, key, { value, writable: true, configurable: true, enumerable: true })
  }
  define('window', g)
  define('document', {
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {} }),
    head: { appendChild() {} }, body: { appendChild() {} },
    addEventListener() {}, removeEventListener() {}, querySelector: () => null,
    getElementById: () => null, documentElement: { style: { setProperty() {} } },
  })
  define('navigator', { userAgent: 'node', language: 'zh-CN', languages: ['zh-CN'] })
  define('localStorage', {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear(),
  })
  define('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  return () => {
    for (const [key, desc] of saved) {
      if (desc === undefined) delete g[key]
      else Object.defineProperty(g, key, desc)
    }
  }
}

test('client 产物可加载：factory 执行不抛（捕获注释泄漏等仅运行期暴露的缺陷）', () => {
  const code = readFileSync(BUNDLE, 'utf8')
  const restore = installGlobals()

  let entry = null
  const g = globalThis
  const prevLoader = g.__ModuleLoader__
  g.__ModuleLoader__ = { load(row) { entry = row }, register(row) { entry = row } }

  try {
    // 复刻宿主注入：宿主把产物当脚本执行，触发其中的 __ModuleLoader__.load(...)
    // eslint-disable-next-line no-new-func
    new Function(code)()

    assert.ok(entry !== null, '产物未调用 __ModuleLoader__.load —— 封装契约不符（期望 window.__ModuleLoader__.load({ id, factory })）')
    assert.equal(entry.id, 'dsh-skill-manager', `封装 id 应为包名，实际 ${String(entry.id)}`)
    assert.equal(typeof entry.factory, 'function', 'factory 必须是函数')

    // 关键断言：factory 体真执行。裸语句 `src;` 这类只在此刻暴露为 ReferenceError。
    const require = (spec) => {
      if (spec === 'react' || spec === 'react-dom' || spec === 'react/jsx-runtime' || spec === 'react-dom/client') return fakeReact()
      // @deepseek-ai/* 由宿主模块表提供；本用例不驱动它们，给可链式调用的空替身即可。
      const fn = () => fn
      return new Proxy(fn, { get: (_t, p) => (p === '__esModule' ? true : p === 'then' ? undefined : fn), apply: () => fn })
    }
    const exports = entry.factory(require)

    // 浏览器半区的 Cordis 插件契约（knowledge/client/14 §1）：导出 `inject: string[]` + `apply`。
    // **不要求 name**——本插件 Client 入口按官方约定只导出这两项（src/client/index.jsx 头注）。
    assert.ok(exports !== null && typeof exports === 'object', 'factory 应返回模块导出对象')
    assert.ok(Array.isArray(exports.inject), `Client 半区应导出 inject 数组，实际 ${typeof exports.inject}`)
    assert.ok(exports.inject.length > 0, 'inject 不应为空')
    assert.equal(typeof exports.apply, 'function', 'Client 半区应导出 apply 函数')
  } finally {
    g.__ModuleLoader__ = prevLoader
    restore()
  }
})
