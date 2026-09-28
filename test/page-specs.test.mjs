// 配置页字段规格（DSR-026）：存储值 ↔ 草稿文本的互转、非法草稿的判据，以及
// **规格与 Host schema 的字段名一致性**——这一条是把「配置页字段名与 schema 漂移」
// 从静默故障变成机械闸门的判据（漂移时不报错，只表现为该字段在页面上永远读不到值）。

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CONFIG_PAGE_SPECS, isOn, piSpec, skillsDirSpec,
} from '../src/core/model/page-specs.js'
import { CONFIG_NS, PI_FIELD, SKILLS_DIR_FIELD } from '../src/core/model/config-fields.js'
import { configSchema } from '../src/core/model/intent.js'
import { Config } from '../src/adapter/settings.js'
import z from '@deepseek-ai/schemastery'

test('字段名单一事实源：config-fields 的导出与 schema/intent 的导出一致', () => {
  // 三个模块都导出同一组名字（config-fields 是源头，intent 与 page-specs 各自消费）：
  // 任何一处被单独改名都会在这里断裂。
  assert.equal(CONFIG_NS, 'skill-manager')
  assert.equal(SKILLS_DIR_FIELD, 'skillsDir')
  assert.equal(PI_FIELD, 'pi')
  const schema = configSchema(z)
  for (const field of [SKILLS_DIR_FIELD, PI_FIELD]) {
    assert.ok(Object.hasOwn(schema.dict ?? {}, field), `${field} 必须在 schema 里`)
  }
})

test('配置页规格与 Host schema 同键：loader 真读的那份 Config 必须覆盖每个声明字段', () => {
  // 这是本批最要紧的一条：Config 是 loader 实际使用的 schema（plugin.Config），
  // 配置页声明的字段若不在其中，官方表单的 field() 会找不到值（静默为空）。
  const dict = Config.dict ?? {}
  for (const spec of CONFIG_PAGE_SPECS) {
    assert.ok(Object.hasOwn(dict, spec.field), `page-specs 的 ${spec.field} 不在 Config schema 里`)
  }
  // 反向：schema 里除迁移标记与两个聚合字段外，其余都应有页面上可编辑的规格
  const declared = new Set(CONFIG_PAGE_SPECS.map((s) => s.field))
  for (const key of Object.keys(dict)) {
    if (key === 'intentMigrated' || key === 'groups' || key === 'skills') continue
    assert.ok(declared.has(key), `schema 字段 ${key} 没有对应的配置页规格`)
  }
})

test('skillsDir 规格：文本互转、空草稿 = 清除、非串值回落空串', () => {
  assert.equal(skillsDirSpec.field, SKILLS_DIR_FIELD)
  assert.equal(skillsDirSpec.format('E:/x'), 'E:/x')
  assert.equal(skillsDirSpec.format(''), '')
  // 非串（未配置 / 被表达式的值污染）一律回落空串，而不是渲染出 "[object Object]"
  assert.equal(skillsDirSpec.format(undefined), '')
  assert.equal(skillsDirSpec.format(null), '')
  assert.equal(skillsDirSpec.format(42), '')
  assert.deepEqual(skillsDirSpec.parse(''), { kind: 'clear' })
  assert.deepEqual(skillsDirSpec.parse('   '), { kind: 'clear' })
  assert.deepEqual(skillsDirSpec.parse('E:/Project/Skills'), { kind: 'set', value: 'E:/Project/Skills' })
  // 首尾空白被 trim（Host 侧的绝对路径校验对空白敏感，不能让草稿把它带进去）
  assert.deepEqual(skillsDirSpec.parse('  E:/Project/Skills  '), { kind: 'set', value: 'E:/Project/Skills' })
  // 刻意**不**在客户端判「是否绝对路径」：权威在 Host 的 internal/config 校验上，
  // 越界由 Host 拒绝并回读（官方模型的既有姿态）。故相对路径也照常产出 set。
  assert.deepEqual(skillsDirSpec.parse('relative/path'), { kind: 'set', value: 'relative/path' })
})

test('pi 规格：布尔文本化、只接受 true/false、其余判非法', () => {
  assert.equal(piSpec.field, PI_FIELD)
  assert.equal(piSpec.format(true), 'true')
  assert.equal(piSpec.format(false), 'false')
  // 非真值一律按 false 渲染（字段缺省即不接管）
  assert.equal(piSpec.format(undefined), 'false')
  assert.equal(piSpec.format(null), 'false')
  assert.equal(piSpec.format(1), 'false')
  assert.deepEqual(piSpec.parse('true'), { kind: 'set', value: true })
  assert.deepEqual(piSpec.parse('false'), { kind: 'set', value: false })
  assert.deepEqual(piSpec.parse(' TRUE '), { kind: 'set', value: true })
  assert.deepEqual(piSpec.parse('False'), { kind: 'set', value: false })
  // 非法草稿返回 undefined ⇒ 官方表单记为 invalid 并阻止保存（而不是悄悄丢弃编辑）
  for (const bad of ['', 'yes', 'on', '1', '0', 'null']) {
    assert.equal(piSpec.parse(bad), undefined, `${JSON.stringify(bad)} 应判非法`)
  }
})

test('isOn：自绘复选框读草稿文本的判据', () => {
  assert.equal(isOn('true'), true)
  assert.equal(isOn(' TRUE '), true)
  assert.equal(isOn('false'), false)
  assert.equal(isOn(''), false)
  assert.equal(isOn(undefined), false)
})

test('规格顺序稳定：官方模型按声明顺序暂存与规划，顺序变了保存的 op 顺序也变', () => {
  assert.deepEqual(CONFIG_PAGE_SPECS.map((s) => s.field), [SKILLS_DIR_FIELD, PI_FIELD])
})

test('规格对象满足官方 SettingsFieldSpec 形状（结构类型，故无需 import 官方包即可钉住）', () => {
  for (const spec of CONFIG_PAGE_SPECS) {
    assert.equal(typeof spec.field, 'string')
    assert.equal(typeof spec.format, 'function')
    assert.equal(typeof spec.parse, 'function')
    // parse 的取值域经归一后必须落在三个形状里，否则官方模型的 plan() 会静默丢写
    for (const text of ['', 'x', 'true', 'false']) {
      const write = spec.parse(text)
      if (write === undefined) continue
      assert.ok(write.kind === 'set' || write.kind === 'clear', `${spec.field} 的 parse 返回了未知 kind`)
      if (write.kind === 'set') assert.ok('value' in write, `${spec.field} 的 set 缺 value`)
    }
  }
})
