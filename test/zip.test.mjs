// zip.js 单元测试：store/deflate 条目、UTF-8 文件名、数据描述符形态、
// 结构损坏五分支（中央目录缺失/越界/条目损坏/本地头损坏/不支持压缩法）与空 zip。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { unzip } from '../src/core/base/zip.js'
import { buildZip } from './helpers.mjs'

test('unzip：store 与 deflate 条目、UTF-8 文件名、目录条目跳过', () => {
  const zip = buildZip([
    { name: 'a.txt', data: Buffer.from('内容A', 'utf8'), method: 0 },
    { name: 'dir/b.txt', data: Buffer.from('content-b'.repeat(50), 'utf8'), method: 8 },
    { name: 'dir/', data: Buffer.alloc(0), method: 0 },
  ])
  const files = unzip(zip)
  assert.equal(files['a.txt'].toString('utf8'), '内容A')
  assert.equal(files['dir/b.txt'].toString('utf8'), 'content-b'.repeat(50))
  assert.equal(files['dir/'], undefined) // 目录条目以 / 结尾 → 跳过
})

test('unzip：空 zip（count=0）返回空映射', () => {
  assert.deepEqual(unzip(buildZip([])), {})
})

test('unzip：损坏结构五分支全部显式 bad-zipball', () => {
  // 中央目录结束标记缺失
  assert.throws(() => unzip(Buffer.from('not a zip at all!')), /中央目录/)

  // 中央目录越界：eocd 的 cenOffset 指到缓冲区外
  const outOfBounds = buildZip([{ name: 'a.txt', data: Buffer.from('x'), method: 0 }])
  outOfBounds.writeUInt32LE(outOfBounds.length, outOfBounds.length - 22 + 16)
  assert.throws(() => unzip(outOfBounds), /中央目录越界/)

  // 中央目录条目损坏：首条中央目录签名不对
  const badCen = buildZip([{ name: 'a.txt', data: Buffer.from('x'), method: 0 }])
  const cenOffset = badCen.readUInt32LE(badCen.length - 22 + 16)
  badCen.writeUInt32LE(0xdeadbeef, cenOffset)
  assert.throws(() => unzip(badCen), /中央目录条目损坏/)

  // 本地文件头损坏：local offset 处签名不对
  const badLoc = buildZip([{ name: 'a.txt', data: Buffer.from('x'), method: 0 }])
  badLoc.writeUInt32LE(0xdeadbeef, 0)
  assert.throws(() => unzip(badLoc), /本地文件头损坏/)

  // 不支持的压缩方法（99）
  const badMethod = buildZip([{ name: 'a.txt', data: Buffer.from('x'), method: 0 }])
  const cen2 = badMethod.readUInt32LE(badMethod.length - 22 + 16)
  badMethod.writeUInt16LE(99, cen2 + 10)
  assert.throws(() => unzip(badMethod), /不支持的压缩方法 99/)
})
