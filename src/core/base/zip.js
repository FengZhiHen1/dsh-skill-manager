// zip — 极简 ZIP 读取器：只读、零依赖，只用 node:zlib。
//
// 边界：只服务 zipball 解包一侧，不支持 zip64、加密与分卷。
// 形态不支持或结构损坏一律抛 bad-zipball，不做静默降级。
// 参考：入站操作.md「搜索与仓库探测」。

import { inflateRawSync } from 'node:zlib'
import { SkillManagerError } from './errors.js'

const EOCD_SIG = 0x06054b50
const CEN_SIG = 0x02014b50
const LOC_SIG = 0x04034b50

/** 结构损坏 → 统一 bad-zipball（消息保留原诊断文本）。 */
function badZip(detail) {
  return new SkillManagerError('bad-zipball', `ZIP 结构异常：${detail}`)
}

/** 在尾部 64KB+22 字节内反向查找 EOCD（容忍任意长度注释）。 */
function findEocd(buffer) {
  const start = Math.max(0, buffer.length - 22 - 0xffff)
  for (let i = buffer.length - 22; i >= start; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD_SIG) return i
  }
  throw badZip('找不到中央目录结束标记')
}

/**
 * 解包 ZIP 字节流，返回文件名到内容的映射。
 * 键是正斜杠相对路径；目录条目不产出键。
 * 尺寸与偏移以中央目录为准，因此兼容流式写入的数据描述符条目。
 * @param {Buffer} buffer
 * @returns {Record<string, Buffer>} 文件名（正斜杠相对路径）→ 内容
 * @throws {SkillManagerError} bad-zipball — 中央目录缺失、越界或条目形态不支持
 */
export function unzip(buffer) {
  const eocd = findEocd(buffer)
  const count = buffer.readUInt16LE(eocd + 10)
  const cenSize = buffer.readUInt32LE(eocd + 12)
  const cenOffset = buffer.readUInt32LE(eocd + 16)
  if (count === 0) return {}
  const cenEnd = cenOffset + cenSize
  if (cenEnd > buffer.length) throw badZip('中央目录越界')

  const entries = new Map()
  let pos = cenOffset
  for (let i = 0; i < count; i += 1) {
    if (pos + 46 > cenEnd || buffer.readUInt32LE(pos) !== CEN_SIG) {
      throw badZip('中央目录条目损坏')
    }
    const method = buffer.readUInt16LE(pos + 10)
    const compressedSize = buffer.readUInt32LE(pos + 24) // 中央目录偏移 24 是压缩尺寸（20 是未压缩尺寸）
    const nameLen = buffer.readUInt16LE(pos + 28)
    const extraLen = buffer.readUInt16LE(pos + 30)
    const commentLen = buffer.readUInt16LE(pos + 32)
    const localOffset = buffer.readUInt32LE(pos + 42)
    const name = buffer.toString('utf8', pos + 46, pos + 46 + nameLen)
    // 目录条目（以 / 结尾）不产出文件
    if (!name.endsWith('/')) {
      const body = readEntryBody(buffer, localOffset, method, compressedSize)
      entries.set(name, body)
    }
    pos += 46 + nameLen + extraLen + commentLen
  }
  return Object.fromEntries(entries)
}

function readEntryBody(buffer, localOffset, method, compressedSize) {
  if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== LOC_SIG) {
    throw badZip('本地文件头损坏')
  }
  const nameLen = buffer.readUInt16LE(localOffset + 26)
  const extraLen = buffer.readUInt16LE(localOffset + 28)
  const dataStart = localOffset + 30 + nameLen + extraLen
  const data = buffer.subarray(dataStart, dataStart + compressedSize)
  if (method === 0) return Buffer.from(data)
  if (method === 8) return inflateRawSync(data)
  throw badZip(`条目使用了不支持的压缩方法 ${method}`)
}
