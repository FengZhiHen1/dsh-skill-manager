// zip.js 单元测试：store/deflate 条目、UTF-8 文件名、数据描述符形态。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deflateRawSync } from 'node:zlib'
import { unzip } from '../src/core/base/zip.js'

/** 构造最小 ZIP（中央目录为准；local 头可含 0 尺寸模拟流式写入形态）。 */
function buildZip(entries) {
  const localParts = []
  const centralParts = []
  let offset = 0
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8')
    const data = e.method === 8 ? deflateRawSync(e.data) : e.data
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // UTF-8 标志
    local.writeUInt16LE(e.method, 8)
    local.writeUInt32LE(0, 10)
    local.writeUInt32LE(0, 14) // 流式形态：local 头尺寸为 0
    local.writeUInt32LE(0, 18)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    localParts.push(local, nameBuf, data)
    const cen = Buffer.alloc(46)
    cen.writeUInt32LE(0x02014b50, 0)
    cen.writeUInt16LE(20, 4)
    cen.writeUInt16LE(20, 6)
    cen.writeUInt16LE(0x0800, 8)
    cen.writeUInt16LE(e.method, 10)
    cen.writeUInt32LE(0, 12)
    cen.writeUInt32LE(e.data.length, 20)
    cen.writeUInt32LE(data.length, 24)
    cen.writeUInt16LE(nameBuf.length, 28)
    cen.writeUInt16LE(0, 30)
    cen.writeUInt16LE(0, 32)
    cen.writeUInt16LE(0, 34)
    cen.writeUInt16LE(0, 36)
    cen.writeUInt32LE(0, 38)
    cen.writeUInt32LE(offset, 42)
    centralParts.push(cen, nameBuf)
    offset += local.length + nameBuf.length + data.length
  }
  const cenBuf = Buffer.concat(centralParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cenBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...localParts, cenBuf, eocd])
}

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

test('unzip：损坏结构抛错', () => {
  assert.throws(() => unzip(Buffer.from('not a zip at all!')), /中央目录/)
})
