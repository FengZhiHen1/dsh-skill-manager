// fence.js 单元测试：回环/受信权威 + 同源标记。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isTrustedApiRequest, isLoopbackHostname } from '../lib/fence.js'

const req = (headers) => ({ headers })

test('isLoopbackHostname：localhost/127.x/[::1]', () => {
  assert.equal(isLoopbackHostname('localhost'), true)
  assert.equal(isLoopbackHostname('127.0.0.1'), true)
  assert.equal(isLoopbackHostname('[::1]'), true)
  assert.equal(isLoopbackHostname('192.168.1.5'), false)
})

test('回环请求 + 同源 origin 通过', () => {
  assert.equal(
    isTrustedApiRequest(req({ host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' }), []),
    true,
  )
  assert.equal(
    isTrustedApiRequest(req({ host: 'localhost:3080', origin: 'http://localhost:3080' }), []),
    true,
  )
  // 无 origin（非浏览器客户端）也通过
  assert.equal(isTrustedApiRequest(req({ host: '127.0.0.1:3080' }), []), true)
})

test('拒绝：跨站标记、异源 origin、非受信 host', () => {
  assert.equal(
    isTrustedApiRequest(req({ host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site' }), []),
    false,
  )
  assert.equal(
    isTrustedApiRequest(req({ host: '127.0.0.1:3080', origin: 'http://evil.example' }), []),
    false,
  )
  assert.equal(
    isTrustedApiRequest(req({ host: '192.168.1.9:3080', origin: 'http://192.168.1.9:3080' }), []),
    false,
  )
  assert.equal(isTrustedApiRequest(req({}), []), false)
})

test('受信 host：trustedHosts 匹配时通过', () => {
  assert.equal(
    isTrustedApiRequest(req({ host: '192.168.1.9:3080', origin: 'http://192.168.1.9:3080' }), ['192.168.1.9']),
    true,
  )
  assert.equal(
    isTrustedApiRequest(req({ host: '192.168.1.9:3080', origin: 'http://evil.example' }), ['192.168.1.9']),
    false,
  )
})
